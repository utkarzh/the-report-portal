import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { TRANSCRIPTION_AUDIO_BUCKET } from '@/lib/transcriptions'
import {
  submitTranscript,
  getTranscript,
  formatSpeakerTranscript,
  ASSEMBLYAI_TRANSCRIBE_MODEL,
} from '@/lib/assemblyai/client'

// AssemblyAI transcription (speaker-diarized). Async job model:
//   POST  → submit the whole original file as one job, store the job id.
//           Idempotent: if a job is already in flight, returns it.
//   GET   → poll the job. When complete, format the speaker-labelled utterances
//           into raw_transcript and flip status to 'transcribed'.
//
// No chunking: diarization needs the full recording so speaker labels stay
// consistent across the whole file.

// Loads the row and authorises the caller. Returns the row or an error response.
async function loadRow(request: NextRequest, id: string) {
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
    .from('transcriptions')
    .select('id, user_id, audio_path, audio_mime, status, transcribe_job_id, raw_transcript')
    .eq('id', id)
    .single()

  if (!row) return { error: NextResponse.json({ error: 'Transcription not found' }, { status: 404 }) }
  if (row.user_id !== user.id && profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { row }
}

// POST — submit (or resume) the transcription job.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { row, error } = await loadRow(request, params.id)
  if (error) return error

  // Already have a job (or a finished transcript)? Don't resubmit — this makes
  // retries and double-mounts harmless.
  if (row!.transcribe_job_id) {
    return NextResponse.json({ jobId: row!.transcribe_job_id, resumed: true })
  }

  try {
    // AssemblyAI fetches the audio itself from a short-lived signed URL.
    const { data: signed, error: signErr } = await supabaseAdmin
      .storage
      .from(TRANSCRIPTION_AUDIO_BUCKET)
      .createSignedUrl(row!.audio_path, 3600)

    if (signErr || !signed?.signedUrl) throw new Error('Could not sign audio URL for transcription')

    const jobId = await submitTranscript(signed.signedUrl)

    await supabaseAdmin
      .from('transcriptions')
      .update({
        status: 'transcribing',
        transcribe_job_id: jobId,
        transcribe_model: ASSEMBLYAI_TRANSCRIBE_MODEL,
        error: null,
      })
      .eq('id', row!.id)

    return NextResponse.json({ jobId })
  } catch (err) {
    console.error('AssemblyAI submit error:', err)
    await supabaseAdmin
      .from('transcriptions')
      .update({ status: 'failed', error: 'Could not start transcription. Please try again.' })
      .eq('id', row!.id)
    return NextResponse.json({ error: 'Could not start transcription. Please try again.' }, { status: 502 })
  }
}

// GET — poll the job's status. Persists the transcript when it completes.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { row, error } = await loadRow(request, params.id)
  if (error) return error

  // Already finished (e.g. after a reload).
  if (row!.raw_transcript) {
    return NextResponse.json({ status: 'completed', text: row!.raw_transcript })
  }
  if (!row!.transcribe_job_id) {
    return NextResponse.json({ status: 'not_started' })
  }

  try {
    const job = await getTranscript(row!.transcribe_job_id)

    if (job.status === 'error') {
      await supabaseAdmin
        .from('transcriptions')
        .update({ status: 'failed', error: job.error || 'Transcription failed' })
        .eq('id', row!.id)
      return NextResponse.json({ status: 'error', error: 'Transcription failed. Please try again.' })
    }

    if (job.status === 'completed') {
      const text = formatSpeakerTranscript(job)
      await supabaseAdmin
        .from('transcriptions')
        .update({ status: 'transcribed', raw_transcript: text, error: null })
        .eq('id', row!.id)
      return NextResponse.json({ status: 'completed', text })
    }

    // queued | processing
    return NextResponse.json({ status: job.status })
  } catch (err) {
    console.error('AssemblyAI poll error:', err)
    // Transient poll failure — don't mark the row failed; let the client retry.
    return NextResponse.json({ status: 'processing' })
  }
}
