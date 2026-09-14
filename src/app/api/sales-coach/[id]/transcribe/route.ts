import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { SALES_COACH_AUDIO_BUCKET } from '@/lib/sales-coach'
import { submitTranscript, getTranscript, formatSpeakerTranscript, utteranceSegments } from '@/lib/assemblyai/client'

export const runtime = 'nodejs'

// AssemblyAI transcription for a Sales Coach audio submission (US-037) — the
// same async job model as the Transcription module:
//   POST → submit the compressed MP3 as ONE diarised job, store the job id.
//          Idempotent: a job already in flight is simply returned.
//   GET  → poll. On completion the speaker-labelled text lands in
//          `system_transcript` and the stage advances to 'transcribed'.

async function loadRow(id: string) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()
  if (!profile || profile.status === 'inactive') {
    return { error: NextResponse.json({ error: 'Account inactive' }, { status: 403 }) }
  }

  const { data: row } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('id, user_id, audio_path, stage, transcribe_job_id, system_transcript')
    .eq('id', id)
    .single()
  if (!row) return { error: NextResponse.json({ error: 'Negotiation not found' }, { status: 404 }) }
  if (row.user_id !== user.id && profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { row }
}

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const { row, error } = await loadRow(params.id)
  if (error) return error

  if (row!.system_transcript) {
    return NextResponse.json({ status: 'completed', resumed: true })
  }
  if (!row!.audio_path) {
    return NextResponse.json({ error: 'This negotiation has no audio to transcribe' }, { status: 409 })
  }
  if (row!.transcribe_job_id) {
    return NextResponse.json({ jobId: row!.transcribe_job_id, resumed: true })
  }

  try {
    const { data: signed, error: signErr } = await supabaseAdmin
      .storage
      .from(SALES_COACH_AUDIO_BUCKET)
      .createSignedUrl(row!.audio_path, 3600)
    if (signErr || !signed?.signedUrl) throw new Error('Could not sign audio URL for transcription')

    const jobId = await submitTranscript(signed.signedUrl)

    await supabaseAdmin
      .from('sales_coach_negotiations')
      .update({ stage: 'transcribing', transcribe_job_id: jobId, error: null })
      .eq('id', row!.id)

    return NextResponse.json({ jobId })
  } catch (err) {
    console.error('Sales coach AssemblyAI submit error:', err)
    await supabaseAdmin
      .from('sales_coach_negotiations')
      .update({ stage: 'failed', error: 'Could not start transcription. Please try again.' })
      .eq('id', row!.id)
    return NextResponse.json({ error: 'Could not start transcription. Please try again.' }, { status: 502 })
  }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const { row, error } = await loadRow(params.id)
  if (error) return error

  if (row!.system_transcript) {
    return NextResponse.json({ status: 'completed', text: row!.system_transcript })
  }
  if (!row!.transcribe_job_id) {
    return NextResponse.json({ status: 'not_started' })
  }

  try {
    const job = await getTranscript(row!.transcribe_job_id)

    if (job.status === 'error') {
      await supabaseAdmin
        .from('sales_coach_negotiations')
        .update({ stage: 'failed', error: job.error || 'Transcription failed' })
        .eq('id', row!.id)
      return NextResponse.json({ status: 'error', error: 'Transcription failed. Please try again.' })
    }

    if (job.status === 'completed') {
      const text = formatSpeakerTranscript(job)
      const segments = utteranceSegments(job)
      await supabaseAdmin
        .from('sales_coach_negotiations')
        .update({
          stage: 'transcribed',
          system_transcript: text,
          system_transcript_segments: segments.length > 0 ? segments : null,
          error: null,
        })
        .eq('id', row!.id)
      return NextResponse.json({ status: 'completed', text })
    }

    return NextResponse.json({ status: job.status })
  } catch (err) {
    console.error('Sales coach AssemblyAI poll error:', err)
    return NextResponse.json({ status: 'processing' })
  }
}
