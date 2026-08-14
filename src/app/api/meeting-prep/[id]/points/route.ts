import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, MEETING_PREP_POINTS_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { parsePoints, researchSectionsToPrompt } from '@/lib/meeting-prep'
import type { MeetingPrepResearchSections } from '@/types'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 120

interface Params {
  params: { id: string }
}

// POST /api/meeting-prep/[id]/points
// No body + stage 'awaiting_review' -> first-time generation of the 3 points.
// Body {regenerateIndex, feedback} + stage 'points_pending' -> targeted or
// full regeneration (US-028).
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
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < MEETING_PREP_POINTS_RESERVE) {
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

  const isRegenerate = session.stage === 'points_pending'
  if (!isRegenerate && session.stage !== 'awaiting_review') {
    return NextResponse.json({ error: 'This session is not ready for presentation points.' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({}))
  const { regenerateIndex, feedback } = body as { regenerateIndex?: number; feedback?: string }

  let promptText = session.points_prompt_snapshot as string | null
  if (!promptText) {
    const { data: promptRow } = await supabaseAdmin
      .from('meeting_prep_prompt')
      .select('prompt_text')
      .eq('prompt_key', 'presentation_points')
      .maybeSingle()
    promptText = promptRow?.prompt_text || ''
  }

  const researchContext = researchSectionsToPrompt(session.research_sections as MeetingPrepResearchSections)
  const anthropic = getAnthropicClient()

  try {
    let userContent: string
    if (!isRegenerate) {
      userContent = `${researchContext}\n\nGenerate the 3 presentation points now.`
    } else if (regenerateIndex !== undefined) {
      const current = (session.presentation_points || []) as string[]
      const others = current.filter((_, i) => i !== regenerateIndex)
      userContent = `${researchContext}\n\n--- OTHER TWO APPROVED POINTS (this new one must stay genuinely distinct from these) ---\n${others.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n--- CURRENT POINT TO REPLACE ---\n${current[regenerateIndex] || ''}\n\n--- SALES REP'S FEEDBACK ---\n${(feedback || '').trim() || 'Improve this point.'}\n\nReturn ONLY the replacement point text, one to three sentences, no numbering, no other commentary.`
    } else {
      userContent = `${researchContext}\n\n--- CURRENT 3 POINTS (sales rep wants all reframed) ---\n${(session.presentation_points || []).map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}\n\n--- SALES REP'S FEEDBACK ---\n${(feedback || '').trim() || 'Reframe all three points.'}\n\nGenerate 3 new presentation points now.`
    }

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: promptText || undefined,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const usage = parseUsage(message.usage as unknown, 0)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

    let points: string[]
    if (regenerateIndex !== undefined) {
      const current = [...((session.presentation_points || []) as string[])]
      current[regenerateIndex] = text.trim()
      points = current
    } else {
      points = parsePoints(text).slice(0, 3)
    }

    const updates: Record<string, unknown> = {
      presentation_points: points,
      tokens_input: (session.tokens_input || 0) + promptTokens,
      tokens_output: (session.tokens_output || 0) + usage.outputTokens,
      tokens_total: (session.tokens_total || 0) + totalTokens,
      cost_usd: Number(session.cost_usd || 0) + cost,
    }
    if (!isRegenerate) {
      updates.stage = 'points_pending'
      updates.points_prompt_snapshot = promptText
    }

    await supabaseAdmin.from('meeting_prep_sessions').update(updates).eq('id', session.id)
    await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })

    await logUsageEvent({
      userId: user.id,
      workflow: 'meeting_prep_points',
      sourceId: session.id,
      model: CLAUDE_MODEL,
      tokensInput: promptTokens,
      tokensOutput: usage.outputTokens,
      tokensTotal: totalTokens,
      costUsd: cost,
    })

    return NextResponse.json({ points, usage: { tokens_total: totalTokens, cost_usd: cost } })
  } catch (err) {
    console.error('Meeting prep points error:', err)
    if (!isRegenerate) {
      await supabaseAdmin
        .from('meeting_prep_sessions')
        .update({ stage: 'failed', error: err instanceof Error ? err.message : 'Failed to generate presentation points' })
        .eq('id', session.id)
    }
    await logUsageEvent({
      userId: user.id,
      workflow: 'meeting_prep_points',
      sourceId: session.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Failed to generate presentation points',
    })
    return NextResponse.json({ error: 'Failed to generate presentation points. Please try again.' }, { status: 500 })
  }
}
