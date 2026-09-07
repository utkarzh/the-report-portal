import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { canAccessSalesNegotiationCoach } from '@/lib/access'
import { isSalesCoachOutcome } from '@/lib/sales-coach'
import type { SalesCoachParticipant } from '@/types'

export const runtime = 'nodejs'

// POST /api/sales-coach — create a negotiation record (US-034/035/036).
// The Sales Executive has already uploaded the audio directly to the private
// bucket (RLS-scoped to their own folder), or pasted/uploaded a transcript.
// Every submission is bound to the logged-in user (US-033); there is no
// user-selectable "submit as".
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status, full_name, can_access_sales_negotiation_coach')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (!canAccessSalesNegotiationCoach(profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const {
    country, mediaPublication, company, intervieweeName, intervieweePosition,
    companyReps, trcMembers, otherComments,
    audioPath, audioMime, uploadedTranscript, originalFilename,
    declaredOutcome, outcomeDetails,
  } = body as Record<string, unknown>

  // Declared outcome is required and single-choice (US-036).
  if (!isSalesCoachOutcome(declaredOutcome)) {
    return NextResponse.json({ error: 'A valid declared outcome is required' }, { status: 400 })
  }

  // Must supply SOMETHING to analyse — audio or a transcript (US-035).
  const hasAudio = typeof audioPath === 'string' && audioPath.trim().length > 0
  const hasTranscript = typeof uploadedTranscript === 'string' && uploadedTranscript.trim().length > 0
  if (!hasAudio && !hasTranscript) {
    return NextResponse.json({ error: 'Upload an audio recording or provide a transcript' }, { status: 400 })
  }

  // Audio path must live in the caller's own folder (mirrors storage RLS).
  if (hasAudio && !(audioPath as string).startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Invalid audio path' }, { status: 403 })
  }

  const cleanParticipants = (v: unknown): SalesCoachParticipant[] =>
    Array.isArray(v)
      ? v
          .map((p) => ({ name: String((p as { name?: unknown }).name ?? '').trim(), role: String((p as { role?: unknown }).role ?? '').trim() }))
          .filter((p) => p.name || p.role)
      : []

  const { data: row, error } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .insert({
      user_id: user.id,
      submitted_by_name: profile.full_name || '',
      country: str(country),
      media_publication: str(mediaPublication),
      company: str(company),
      interviewee_name: str(intervieweeName),
      interviewee_position: str(intervieweePosition),
      company_reps: cleanParticipants(companyReps),
      trc_members: cleanParticipants(trcMembers),
      other_comments: str(otherComments),
      original_filename: str(originalFilename),
      audio_path: hasAudio ? (audioPath as string) : null,
      audio_mime: str(audioMime),
      uploaded_transcript: hasTranscript ? (uploadedTranscript as string).trim() : null,
      declared_outcome: declaredOutcome,
      outcome_details: (outcomeDetails && typeof outcomeDetails === 'object') ? outcomeDetails : {},
      // Audio needs transcribing first; a pasted transcript is ready for analysis.
      stage: hasAudio ? 'transcribing' : 'transcribed',
    })
    .select('id')
    .single()

  if (error || !row) {
    console.error('Failed to create negotiation:', error)
    return NextResponse.json({ error: 'Could not start the negotiation. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ id: row.id }, { status: 201 })
}

function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length > 0 ? s : null
}
