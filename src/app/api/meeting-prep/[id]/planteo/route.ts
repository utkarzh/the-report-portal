import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, MEETING_PREP_PLANTEO_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { researchSectionsToPrompt } from '@/lib/meeting-prep'
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

  const researchContext = researchSectionsToPrompt(session.research_sections as MeetingPrepResearchSections)
  const points = ((session.presentation_points || []) as string[]).map((p, i) => `${i + 1}. ${p}`).join('\n')
  const anthropic = getAnthropicClient()

  const system = `${promptText}\n\n--- APPROVED PLANTEO LIBRARY FORMULA FOR THIS VARIANT (source of truth — do not deviate) ---\n${libraryText || '(no formula has been added to the Planteo Library yet for this variant — use the structure described in your instructions above as closely as possible, and note in the output where the approved formula is still pending)'}`

  const userContent = isRegenerate
    ? `${researchContext}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\n--- CURRENT PLANTEO (sales rep wants changes) ---\n${session.planteo_output || ''}\n\n--- SALES REP'S FEEDBACK ---\n${(feedback || '').trim() || 'Improve this planteo.'}`
    : `${researchContext}\n\n--- APPROVED PRESENTATION POINTS ---\n${points}\n\nBuild the planteo now.`

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

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

    return NextResponse.json({ planteo: text })
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
