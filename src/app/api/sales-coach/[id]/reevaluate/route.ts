import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { canAccessSalesNegotiationCoach } from '@/lib/access'
import { SALES_COACH_ANALYZE_RESERVE } from '@/lib/claude/tokens'
import { isMissingReevaluatedColumn, isSalesCoachOutcome, pickTranscript } from '@/lib/sales-coach'
import type { SalesCoachNegotiation } from '@/types'

export const runtime = 'nodejs'

// A copy of the same negotiation made this recently that hasn't produced a
// card yet is the same click (double-click, or postWithRetry re-sending a
// request that did land) — return it instead of creating a twin.
const DEDUPE_WINDOW_MS = 2 * 60_000

// POST /api/sales-coach/[id]/reevaluate — "Re-evaluate". Copies an existing
// negotiation into a NEW one — every submitted field, the transcript (plus
// its audio and timestamps) and any fact corrections — at stage
// 'transcribed', so the workspace opened with ?start=1 generates a fresh
// Report Card straight away: no form to refill, no transcription to wait for.
// The original negotiation, its card and its coaching conversation are left
// untouched; the copy starts with an empty coaching conversation.
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status, tokens_used, token_limit, can_access_sales_negotiation_coach')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (!canAccessSalesNegotiationCoach(profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // The same pre-flight check the Report Card it's about to start runs, done
  // here so a copy is never created that the user can't afford to score.
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < SALES_COACH_ANALYZE_RESERVE) {
    return NextResponse.json({ error: 'Not enough token budget remaining to generate a Report Card' }, { status: 402 })
  }

  const { data: source } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('*')
    .eq('id', params.id)
    .single()
  if (!source) return NextResponse.json({ error: 'Negotiation not found' }, { status: 404 })
  const n = source as SalesCoachNegotiation
  if (n.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!isSalesCoachOutcome(n.declared_outcome)) {
    return NextResponse.json({ error: 'This negotiation has no declared outcome, so it can’t be re-evaluated.' }, { status: 409 })
  }
  if (!pickTranscript(n)) {
    return NextResponse.json({ error: 'This negotiation has no transcript yet, so there is nothing to re-evaluate.' }, { status: 409 })
  }

  // Every re-evaluation points at the ORIGINAL submission, even when it was
  // started from an earlier re-evaluation. (Before migration 036 the column
  // doesn't exist and reevaluated_from is undefined: the source is the root.)
  const rootId = n.reevaluated_from || n.id

  const { data: recent, error: recentError } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('id')
    .eq('reevaluated_from', rootId)
    .is('report_card', null)
    .in('stage', ['transcribed', 'analyzing'])
    .gte('updated_at', new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString())
    .limit(1)
    .maybeSingle()
  if (recent?.id) return NextResponse.json({ id: recent.id, deduplicated: true }, { status: 200 })
  if (recentError && !isMissingReevaluatedColumn(recentError)) {
    // Non-fatal: the button is also guarded client-side.
    console.error('Re-evaluate dedupe lookup failed:', recentError)
  }

  // Facts the Sales Executive already corrected stay corrected: the analysis
  // folds every correction on record into its prompt, so the copy gets the
  // corrections on the card being re-evaluated — exactly those, so one an
  // admin deleted from this card stays deleted. Read before anything is
  // created, so a failed read leaves nothing behind.
  const { data: correctionRows, error: correctionsError } = await supabaseAdmin
    .from('sales_coach_corrections')
    .select('criterion_key, field_label, ai_said, correction, submitted_by, created_at')
    .eq('negotiation_id', n.id)
    .order('created_at', { ascending: true })
  if (correctionsError) {
    console.error('Re-evaluate: failed to read corrections:', correctionsError)
    return NextResponse.json({ error: 'Could not start the re-evaluation. Please try again.' }, { status: 500 })
  }
  const corrections = correctionRows || []

  // Everything the Sales Executive submitted, plus the finished transcript.
  // Owned by the original Sales Executive (an admin re-evaluating someone
  // else's negotiation doesn't take it over), and dated like the original —
  // created_at is what the card shows as "Negotiation of …". Analysis
  // results, costs and the vestigial review columns all start from their
  // defaults; transcribe_job_id isn't copied because the transcript is done.
  const copy = {
    user_id: n.user_id,
    submitted_by_name: n.submitted_by_name,
    country: n.country,
    media_publication: n.media_publication,
    company: n.company,
    interviewee_name: n.interviewee_name,
    interviewee_position: n.interviewee_position,
    company_reps: n.company_reps,
    trc_members: n.trc_members,
    other_comments: n.other_comments,
    original_filename: n.original_filename,
    audio_path: n.audio_path,
    audio_mime: n.audio_mime,
    uploaded_transcript: n.uploaded_transcript,
    system_transcript: n.system_transcript,
    system_transcript_segments: n.system_transcript_segments,
    declared_outcome: n.declared_outcome,
    outcome_details: n.outcome_details,
    stage: 'transcribed',
    created_at: n.created_at,
  }
  const insertCopy = (row: Record<string, unknown>) =>
    supabaseAdmin.from('sales_coach_negotiations').insert(row).select('id').single()

  let { data: created, error: insertError } = await insertCopy({ ...copy, reevaluated_from: rootId })
  if (insertError && isMissingReevaluatedColumn(insertError)) {
    ;({ data: created, error: insertError } = await insertCopy(copy))
  }
  if (insertError || !created) {
    console.error('Re-evaluate: failed to create the copy:', insertError)
    return NextResponse.json({ error: 'Could not start the re-evaluation. Please try again.' }, { status: 500 })
  }

  // If the corrections can't be carried over, remove the copy rather than
  // leave one that would repeat a mistake the Sales Executive already fixed.
  if (corrections.length > 0) {
    const newId = created.id as string
    const { error: copyError } = await supabaseAdmin
      .from('sales_coach_corrections')
      .insert(corrections.map((c: Record<string, unknown>) => ({ ...c, negotiation_id: newId })))
    if (copyError) {
      console.error('Re-evaluate: failed to copy corrections:', copyError)
      const { error: rollbackError } = await supabaseAdmin.from('sales_coach_negotiations').delete().eq('id', newId)
      if (rollbackError) console.error('Re-evaluate: rollback of the copy failed:', rollbackError)
      return NextResponse.json({ error: 'Could not start the re-evaluation. Please try again.' }, { status: 500 })
    }
  }

  return NextResponse.json({ id: created.id }, { status: 201 })
}
