import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, MEETING_PREP_PLANTEO_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { researchSectionsToPrompt, NO_PREAMBLE_INSTRUCTION, extractAfterMarker } from '@/lib/meeting-prep'
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

  // Only the Company CEO formula is a fixed, literal script the client wants
  // reproduced with zero adaptation (reps adapt it live in the room) — no
  // prompt wording can guarantee an LLM reproduces text with zero drift across
  // regenerations, so for this variant we serve it verbatim and skip the API
  // call entirely. The Government Official formula is a strategic framework
  // ("use the approved research to...", "where appropriate...") that genuinely
  // needs the model to reason and personalise per interview — it must still go
  // through the normal generation path below, using the formula as guidance.
  if (session.interviewee_type === 'company_ceo' && libraryText && libraryText.trim()) {
    const text = libraryText
    const updates: Record<string, unknown> = { planteo_output: text }
    if (!isRegenerate) {
      updates.stage = 'planteo_pending'
      updates.planteo_prompt_snapshot = promptText
      updates.planteo_library_snapshot = libraryText
    }
    await supabaseAdmin.from('meeting_prep_sessions').update(updates).eq('id', session.id)
    return NextResponse.json({ planteo: text, usage: { tokens_total: 0, cost_usd: 0 } })
  }

  const researchContext = researchSectionsToPrompt(session.research_sections as MeetingPrepResearchSections)
  const points = ((session.presentation_points || []) as string[]).map((p, i) => `${i + 1}. ${p}`).join('\n')
  const anthropic = getAnthropicClient()

  const system = `${promptText}\n\n--- APPROVED PLANTEO LIBRARY FORMULA FOR THIS VARIANT (source of truth — do not deviate) ---\n${libraryText || '(no formula has been added to the Planteo Library yet for this variant — use the structure described in your instructions above as closely as possible, and note in the output where the approved formula is still pending)'}\n\n${NO_PREAMBLE_INSTRUCTION}`

  const userContent = isRegenerate
    ? `${researchContext}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\n--- CURRENT PLANTEO (sales rep wants changes) ---\n${session.planteo_output || ''}\n\n--- SALES REP'S FEEDBACK ---\n${(feedback || '').trim() || 'Improve this planteo.'}\n\nThe current planteo above is shown in full. Your reply must be the FULL replacement script from start to finish, not just the part the feedback is about. If the feedback targets one part (e.g. "the opening" or "the closing line"), keep everything else from the current version and change only what was targeted — never reply with just the changed portion, a summary, or a shorter excerpt.`
    : `${researchContext}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\nBuild the planteo now.`

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = extractAfterMarker(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

    // Backstop for the prompt instruction above: on a regenerate, if the reply
    // is drastically shorter than what it's replacing, the model likely wrote
    // only the changed portion instead of the full script. There's no fixed
    // item count to verify here (unlike presentation points), so use a length
    // ratio instead. The API call already happened and is billed regardless,
    // so persist its real cost before failing rather than losing it in the
    // catch block below, which logs status only, no token/cost data.
    const previousLength = (session.planteo_output || '').length
    if (isRegenerate && previousLength > 200 && text.length < previousLength * 0.2) {
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
