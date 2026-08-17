import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, MEETING_PREP_FINAL_DOC_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { researchSectionsToPrompt, NO_PREAMBLE_INSTRUCTION, extractAfterMarker } from '@/lib/meeting-prep'
import type { MeetingPrepResearchSections } from '@/types'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 300

interface Params {
  params: { id: string }
}

// US-031's automated QC checklist, reduced to what a cheap heuristic can
// actually verify: the fixed section order is present. Full semantic checks
// (every claim sourced, no overt motivation labels, etc.) are asserted as
// closing instructions inside the prompt itself — this is a backstop, not a
// replacement for that.
const REQUIRED_HEADINGS = [
  /commercial alert/i,
  /snapshot/i,
  /motivation/i,
  /said recently|quotes|news/i,
  /presentation points/i,
  /planteo/i,
]

function missingHeadings(text: string): string[] {
  const missing: string[] = []
  const labels = ['Commercial Alert', 'Interviewee & Company Snapshot', 'Motivation Profile Ranking', 'What They’ve Said Recently', '3 Presentation Points', 'Planteo Build-Up']
  REQUIRED_HEADINGS.forEach((re, i) => {
    if (!re.test(text)) missing.push(labels[i])
  })
  return missing
}

export async function POST(_request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit, can_access_meeting_preparation')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_meeting_preparation) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < MEETING_PREP_FINAL_DOC_RESERVE) {
    return NextResponse.json({ error: 'Not enough token budget remaining' }, { status: 402 })
  }

  const { data: session } = await supabaseAdmin
    .from('meeting_prep_sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (session.stage !== 'planteo_pending') {
    return NextResponse.json({ error: 'This session is not ready for the final document.' }, { status: 409 })
  }

  const { data: promptRow } = await supabaseAdmin
    .from('meeting_prep_prompt')
    .select('prompt_text')
    .eq('prompt_key', 'final_document')
    .maybeSingle()
  const promptText = promptRow?.prompt_text || ''

  const advertiserBlock = session.advertiser_history_status === 'yes'
    ? `Previously advertised with TRC: ${session.advertiser_history_details}`
    : session.advertiser_history_status === 'no'
    ? 'No previous advertising history on record.'
    : 'Not checked / unknown.'
  const researchContext = researchSectionsToPrompt(session.research_sections as MeetingPrepResearchSections)
  const points = ((session.presentation_points || []) as string[]).map((p, i) => `${i + 1}. ${p}`).join('\n')

  const userContent = `--- ADVERTISER HISTORY ---\n${advertiserBlock}\n\n${researchContext}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\n--- APPROVED PLANTEO ---\n${session.planteo_output || ''}\n\nAssemble the final document now.`

  const anthropic = getAnthropicClient()
  let promptTokens = 0
  let outputTokens = 0

  // This route is non-streaming — if Vercel hard-kills it mid-call there is no
  // partial output to fall back on, unlike the streaming research route. So
  // rather than try to recover after the fact, avoid ever attempting the
  // (slower, unrecoverable) corrective second pass unless there's clearly
  // enough of the maxDuration budget left for it to complete safely.
  const requestStartedAt = Date.now()
  const HARD_CAP_MS = maxDuration * 1000
  const CORRECTIVE_PASS_MARGIN_MS = 60_000

  async function runPass(extra?: string): Promise<string> {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: `${promptText}\n\n${NO_PREAMBLE_INSTRUCTION}`,
      messages: [{ role: 'user', content: extra ? `${userContent}\n\n--- CORRECTION NEEDED ---\n${extra}` : userContent }],
    })
    const usage = parseUsage(message.usage as unknown, 0)
    promptTokens += totalPromptTokens(usage)
    outputTokens += usage.outputTokens
    return extractAfterMarker(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
  }

  try {
    let output = await runPass()
    const missing = missingHeadings(output)
    const timeLeftMs = HARD_CAP_MS - (Date.now() - requestStartedAt)
    if (missing.length > 0 && timeLeftMs > CORRECTIVE_PASS_MARGIN_MS) {
      output = await runPass(`Your draft was missing or unclear on these required sections: ${missing.join(', ')}. Regenerate the FULL document with all six sections present, in the required order.`)
    }

    const cost = calculateCost({ inputTokens: promptTokens, outputTokens })
    const totalTokens = promptTokens + outputTokens

    await supabaseAdmin
      .from('meeting_prep_sessions')
      .update({
        final_output: output,
        final_doc_prompt_snapshot: promptText,
        stage: 'complete',
        tokens_input: (session.tokens_input || 0) + promptTokens,
        tokens_output: (session.tokens_output || 0) + outputTokens,
        tokens_total: (session.tokens_total || 0) + totalTokens,
        cost_usd: Number(session.cost_usd || 0) + cost,
      })
      .eq('id', session.id)

    await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })

    await logUsageEvent({
      userId: user.id,
      workflow: 'meeting_prep_final_document',
      sourceId: session.id,
      model: CLAUDE_MODEL,
      tokensInput: promptTokens,
      tokensOutput: outputTokens,
      tokensTotal: totalTokens,
      costUsd: cost,
    })

    return NextResponse.json({ output, usage: { tokens_total: totalTokens, cost_usd: cost } })
  } catch (err) {
    console.error('Meeting prep final document error:', err)
    await supabaseAdmin
      .from('meeting_prep_sessions')
      .update({ stage: 'failed', error: err instanceof Error ? err.message : 'Failed to generate the final document' })
      .eq('id', session.id)
    await logUsageEvent({
      userId: user.id,
      workflow: 'meeting_prep_final_document',
      sourceId: session.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to generate the final document',
    })
    return NextResponse.json({ error: 'Failed to generate the final document. Please try again.' }, { status: 500 })
  }
}
