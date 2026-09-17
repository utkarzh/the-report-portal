import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, MEETING_PREP_PLANTEO_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { researchSectionsToPrompt, advertiserHistoryToPrompt, splitPlanteoOutput, SPOKEN_PLANTEO_MARKER, NO_PREAMBLE_INSTRUCTION, extractAfterMarker } from '@/lib/meeting-prep'
import type { MeetingPrepResearchSections } from '@/types'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 120

interface Params {
  params: { id: string }
}

// POST /api/meeting-prep/[id]/planteo
// No body + stage 'points_pending' -> first-time planteo generation.
// Body {feedback} + stage 'planteo_pending' -> full regeneration with
// feedback (US-029 — the planteo is one continuous spoken script, so a
// "targeted regeneration" is expressed as feedback on the whole draft).
export async function POST(request: NextRequest, { params }: Params) {
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
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < MEETING_PREP_PLANTEO_RESERVE) {
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

  const isRegenerate = session.stage === 'planteo_pending'
  if (!isRegenerate && session.stage !== 'points_pending') {
    return NextResponse.json({ error: 'This session is not ready for the planteo.' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({}))
  const { feedback } = body as { feedback?: string }

  let promptText = session.planteo_prompt_snapshot as string | null
  let libraryText = session.planteo_library_snapshot as string | null
  if (!promptText || libraryText === null) {
    const [{ data: promptRow }, { data: libraryRow }] = await Promise.all([
      supabaseAdmin.from('meeting_prep_prompt').select('prompt_text').eq('prompt_key', 'planteo').maybeSingle(),
      supabaseAdmin.from('meeting_prep_planteo_library').select('template_text').eq('variant', session.interviewee_type).maybeSingle(),
    ])
    promptText = promptRow?.prompt_text || ''
    libraryText = libraryRow?.template_text || ''
  }

  const researchContext = researchSectionsToPrompt(session.research_sections as MeetingPrepResearchSections)
  const points = ((session.presentation_points || []) as string[]).map((p, i) => `${i + 1}. ${p}`).join('\n')
  const advertiserBlock = advertiserHistoryToPrompt(session)
  const anthropic = getAnthropicClient()

  // Only the Company CEO formula is a fixed, literal script the client wants
  // spoken with zero adaptation (reps adapt it live in the room) — no prompt
  // wording can guarantee an LLM reproduces text with zero drift across
  // regenerations, so the script itself is never sent through the model; it
  // is appended verbatim in code below. What DOES still need the model is the
  // internal commercial recommendation (Rule A/B in the "planteo" prompt) that
  // the final document's Commercial Alert section depends on — so this call
  // is scoped to producing ONLY that recommendation, never the spoken text.
  // The Government Official formula, by contrast, is a strategic framework
  // ("use the approved research to...", "where appropriate...") that needs
  // the model to write and personalise the whole thing every time.
  const isCeoFixedFormula = session.interviewee_type === 'company_ceo' && Boolean(libraryText && libraryText.trim())
  const previousRecommendation = splitPlanteoOutput(session.planteo_output || '').recommendation

  const system = isCeoFixedFormula
    ? `${promptText}\n\n--- TASK FOR THIS CALL ---\nDetermine and output ONLY the internal commercial recommendation for this Company Executive (the "Recommended offer / Basis / Why" format described above), using the approved research, advertiser history, and presentation points below. This recommendation is for the sales representative only — never speak it to the interviewee, and never write, reproduce, or paraphrase the spoken planteo/formula itself: the approved formula is appended separately, verbatim, by the system.\n\n${NO_PREAMBLE_INSTRUCTION}`
    : `${promptText}\n\n--- APPROVED PLANTEO LIBRARY FORMULA FOR THIS VARIANT (source of truth — do not deviate) ---\n${libraryText || '(no formula has been added to the Planteo Library yet for this variant — use the structure described in your instructions above as closely as possible, and note in the output where the approved formula is still pending)'}\n\n${NO_PREAMBLE_INSTRUCTION}`

  const userContent = isCeoFixedFormula
    ? isRegenerate
      ? `${researchContext}\n\n--- ADVERTISER HISTORY ---\n${advertiserBlock}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\n--- CURRENT RECOMMENDATION (sales rep wants changes) ---\n${previousRecommendation || '(none yet)'}\n\n--- SALES REP'S FEEDBACK ---\n${(feedback || '').trim() || 'Improve this recommendation.'}\n\nRe-determine the commercial recommendation, taking the feedback into account. Reply with only the updated recommendation.`
      : `${researchContext}\n\n--- ADVERTISER HISTORY ---\n${advertiserBlock}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\nDetermine the commercial recommendation now.`
    : isRegenerate
      ? `${researchContext}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\n--- CURRENT PLANTEO (sales rep wants changes) ---\n${session.planteo_output || ''}\n\n--- SALES REP'S FEEDBACK ---\n${(feedback || '').trim() || 'Improve this planteo.'}\n\nThe current planteo above is shown in full. Your reply must be the FULL replacement script from start to finish, not just the part the feedback is about. If the feedback targets one part (e.g. "the opening" or "the closing line"), keep everything else from the current version and change only what was targeted — never reply with just the changed portion, a summary, or a shorter excerpt.`
      : `${researchContext}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\nBuild the planteo now.`

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: isCeoFixedFormula ? 1024 : 2048,
      system,
      messages: [{ role: 'user', content: userContent }],
    })

    const modelReply = extractAfterMarker(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
    const text = isCeoFixedFormula ? `${modelReply}\n\n${SPOKEN_PLANTEO_MARKER}\n\n${(libraryText as string).trim()}` : modelReply
    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

    // Backstop for the prompt instruction above: on a regenerate, if the reply
    // is drastically shorter than what it's replacing, the model likely wrote
    // only the changed portion instead of the full thing. Compares like for
    // like — just the recommendation for the CEO fixed-formula path (the
    // spoken script never changes, so including it would make the ratio
    // meaningless), the full script otherwise.
    const previousLength = isCeoFixedFormula ? previousRecommendation.length : (session.planteo_output || '').length
    const newLength = isCeoFixedFormula ? modelReply.length : text.length
    if (isRegenerate && previousLength > 50 && newLength < previousLength * 0.2) {
      await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
      await logUsageEvent({
        userId: user.id,
        workflow: 'meeting_prep_planteo',
        sourceId: session.id,
        model: CLAUDE_MODEL,
        tokensInput: promptTokens,
        tokensOutput: usage.outputTokens,
        tokensTotal: totalTokens,
        costUsd: cost,
        status: 'error',
        error: 'Regenerated planteo was suspiciously short compared to the original',
      })
      return NextResponse.json({ error: 'The regenerated planteo looked incomplete compared to the original. Please try again.' }, { status: 500 })
    }

    const updates: Record<string, unknown> = {
      planteo_output: text,
      tokens_input: (session.tokens_input || 0) + promptTokens,
      tokens_output: (session.tokens_output || 0) + usage.outputTokens,
      tokens_total: (session.tokens_total || 0) + totalTokens,
      cost_usd: Number(session.cost_usd || 0) + cost,
    }
    if (!isRegenerate) {
      updates.stage = 'planteo_pending'
      updates.planteo_prompt_snapshot = promptText
      updates.planteo_library_snapshot = libraryText
    }

    await supabaseAdmin.from('meeting_prep_sessions').update(updates).eq('id', session.id)
    await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })

    await logUsageEvent({
      userId: user.id,
      workflow: 'meeting_prep_planteo',
      sourceId: session.id,
      model: CLAUDE_MODEL,
      tokensInput: promptTokens,
      tokensOutput: usage.outputTokens,
      tokensTotal: totalTokens,
      costUsd: cost,
    })

    return NextResponse.json({ planteo: text, usage: { tokens_total: totalTokens, cost_usd: cost } })
  } catch (err) {
    console.error('Meeting prep planteo error:', err)
    if (!isRegenerate) {
      await supabaseAdmin
        .from('meeting_prep_sessions')
        .update({ stage: 'failed', error: err instanceof Error ? err.message : 'Failed to generate the planteo' })
        .eq('id', session.id)
    }
    await logUsageEvent({
      userId: user.id,
      workflow: 'meeting_prep_planteo',
      sourceId: session.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to generate the planteo',
    })
    return NextResponse.json({ error: 'Failed to generate the planteo. Please try again.' }, { status: 500 })
  }
}
