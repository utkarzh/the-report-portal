import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, MEETING_PREP_FINAL_DOC_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { researchSectionsToPrompt, advertiserHistoryToPrompt } from '@/lib/meeting-prep'
import {
  composeFinalDocument, finalBlocksContract, finalSectionsComplete, meetingTypeNoteForDocument, missingFinalBlocks, parseFinalSections,
} from '@/lib/meeting-prep-document'
import { addSessionUsage, claimStage, updateMeetingPrep } from '@/lib/meeting-prep-server'
import type { MeetingPrepResearchSections } from '@/types'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 300

interface Params {
  params: { id: string }
}

// POST /api/meeting-prep/[id]/final-document
// Stage 'planteo_pending' -> writes the document's first four blocks (US-031)
// and completes the session. Points and planteo are inserted by code from
// their own columns (composeFinalDocument), so they're never retyped.
export async function POST(_request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

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
  if (!(await claimStage(session.id, 'planteo_pending', 'final_generating'))) {
    return NextResponse.json({ error: 'The document is already being assembled.' }, { status: 409 })
  }

  const { data: promptRow } = await supabaseAdmin
    .from('meeting_prep_prompt')
    .select('prompt_text')
    .eq('prompt_key', 'final_document')
    .maybeSingle()
  const promptText = promptRow?.prompt_text || ''

  const advertiserBlock = advertiserHistoryToPrompt(session)
  const researchContext = researchSectionsToPrompt(session.research_sections as MeetingPrepResearchSections)
  const points = ((session.presentation_points || []) as string[]).map((p, i) => `${i + 1}. ${p}`).join('\n')

  const userContent = `--- ADVERTISER HISTORY ---\n${advertiserBlock}\n\n${researchContext}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\n--- APPROVED PLANTEO ---\n${session.planteo_output || ''}${meetingTypeNoteForDocument(session.interviewee_type)}\n\nWrite sections 1 to 4 of the final document now.`

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

  const FINAL_DOC_MAX_TOKENS = 8192
  const system = `${promptText}\n\n${finalBlocksContract()}`

  async function callModel(messages: Anthropic.MessageParam[]): Promise<{ text: string; stopReason: string | null }> {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: FINAL_DOC_MAX_TOKENS,
      system,
      messages,
    })
    const usage = parseUsage(message.usage as unknown, 0)
    promptTokens += totalPromptTokens(usage)
    outputTokens += usage.outputTokens
    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    return { text, stopReason: message.stop_reason ?? null }
  }

  // If a pass stops because it ran out of output tokens, continue the SAME
  // response via assistant-turn prefill (the model picks up exactly where it
  // left off — it is not asked to retype anything, so nothing is duplicated)
  // instead of silently saving a cut-off block.
  const MAX_CONTINUATIONS = 3

  async function runPass(extra?: string): Promise<string> {
    const userMsg = extra ? `${userContent}\n\n--- CORRECTION NEEDED ---\n${extra}` : userContent
    let full = ''
    let stopReason: string | null = null
    let rounds = 0
    do {
      const messages: Anthropic.MessageParam[] = full
        ? [{ role: 'user', content: userMsg }, { role: 'assistant', content: full }]
        : [{ role: 'user', content: userMsg }]
      const result = await callModel(messages)
      full += result.text
      stopReason = result.stopReason
      rounds += 1
      const timeLeftMs = HARD_CAP_MS - (Date.now() - requestStartedAt)
      if (timeLeftMs < CORRECTIVE_PASS_MARGIN_MS) break
    } while (stopReason === 'max_tokens' && rounds <= MAX_CONTINUATIONS)
    return full
  }

  try {
    let sections = parseFinalSections(await runPass())
    const timeLeftMs = HARD_CAP_MS - (Date.now() - requestStartedAt)
    if (!finalSectionsComplete(sections) && timeLeftMs > CORRECTIVE_PASS_MARGIN_MS) {
      const retry = parseFinalSections(
        await runPass(`Your reply was missing these sections or their markers: ${missingFinalBlocks(sections).join(', ')}. Write all four sections again, each under its <<<BLOCK:…>>> marker, in order.`),
      )
      // Keep whatever each pass got right.
      sections = { ...retry, ...Object.fromEntries(Object.entries(sections).filter(([, v]) => v?.trim())) }
    }

    const cost = calculateCost({ inputTokens: promptTokens, outputTokens })
    const totalTokens = promptTokens + outputTokens
    await addSessionUsage(session.id, { tokensInput: promptTokens, tokensOutput: outputTokens, cost })
    await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })

    // Nothing usable at all: back to the planteo checkpoint for a retry. A
    // document with only some blocks is saved — each missing block shows
    // its own Regenerate, which is cheaper than redoing the whole pass.
    if (Object.keys(sections).length === 0) {
      await updateMeetingPrep(session.id, {
        stage: 'planteo_pending',
        error: 'The document came back in an unexpected format. Try again: everything else is kept.',
      })
      await logUsageEvent({
        userId: user.id,
        workflow: 'meeting_prep_final_document',
        sourceId: session.id,
        model: CLAUDE_MODEL,
        tokensInput: promptTokens,
        tokensOutput: outputTokens,
        tokensTotal: totalTokens,
        costUsd: cost,
        status: 'error',
        error: 'No document blocks could be parsed',
      })
      return NextResponse.json({ error: 'The document came back in an unexpected format. Please try again.' }, { status: 500 })
    }

    const output = composeFinalDocument({ ...session, final_sections: sections })
    await updateMeetingPrep(session.id, {
      final_sections: sections,
      final_output: output,
      final_doc_prompt_snapshot: promptText,
      stage: 'complete',
      error: null,
    })

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

    return NextResponse.json({ sections, output, usage: { tokens_total: totalTokens, cost_usd: cost } })
  } catch (err) {
    console.error('Meeting prep final document error:', err)
    await updateMeetingPrep(session.id, {
      stage: 'planteo_pending',
      error: 'The document could not be assembled. Try again: everything else is kept.',
    })
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
