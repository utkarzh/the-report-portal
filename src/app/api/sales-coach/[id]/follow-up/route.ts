import { NextRequest, NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import {
  calculateCost,
  parseUsage,
  totalPromptTokens,
  SALES_COACH_FOLLOW_UP_RESERVE,
  SONNET_PRICING,
} from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { followUpSupportApplies } from '@/lib/sales-coach'
import { loadFollowUpDecisionPrompt, loadKnowledgeBundle } from '@/lib/sales-coach-context'
import {
  FOLLOW_UP_MAX_TOKENS, FOLLOW_UP_MODEL, followUpProblem, followUpSystemText, followUpUserText,
} from '@/lib/sales-coach-follow-up'
import type { SalesCoachFollowUpSupport, SalesCoachNegotiation } from '@/types'

export const maxDuration = 120
// Leave room under maxDuration for the save and billing after the model calls.
const SOFT_DEADLINE_MS = 100_000

// POST /api/sales-coach/[id]/follow-up — writes (or rewrites) the Report Card's
// Follow-Up Decision Support from Rafa's prompt and playbook
// (sales-coach-follow-up.ts). Owner or admin; budget checked before any cost;
// one corrective re-prompt at most; saved into report_card.follow_up_support
// only if the card is unchanged since it was read; spend billed either way.
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const startedAt = Date.now()
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const [{ data: profile }, { data: neg }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, role, status, tokens_used, token_limit, can_access_sales_negotiation_coach')
      .eq('id', user.id)
      .single(),
    supabaseAdmin.from('sales_coach_negotiations').select('*').eq('id', params.id).single(),
  ])
  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_sales_negotiation_coach) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!neg) return NextResponse.json({ error: 'Negotiation not found' }, { status: 404 })
  const n = neg as SalesCoachNegotiation
  if (n.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!n.report_card || n.stage !== 'complete') {
    return NextResponse.json({ error: 'The Report Card is not ready yet.' }, { status: 409 })
  }
  if (!followUpSupportApplies(n.report_card)) {
    return NextResponse.json({ error: 'A signed deal has no follow-up recommendations.' }, { status: 409 })
  }
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < SALES_COACH_FOLLOW_UP_RESERVE) {
    return NextResponse.json({ error: "You've reached your monthly AI limit, so the follow-up recommendations can't be written." }, { status: 402 })
  }

  const [knowledge, prompt] = await Promise.all([loadKnowledgeBundle(), loadFollowUpDecisionPrompt()])
  // Rafa's prompt + the TRC documents are the same for every meeting: cache them.
  const system = [{
    type: 'text' as const,
    text: followUpSystemText(prompt.text, knowledge),
    cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
  }]
  const userText = followUpUserText(n, prompt.text)

  const anthropic = getAnthropicClient()
  let promptTokens = 0
  let outputTokens = 0
  let cost = 0
  const call = async (messages: Anthropic.MessageParam[]): Promise<string> => {
    const left = SOFT_DEADLINE_MS - (Date.now() - startedAt)
    const msg = await anthropic.messages.create(
      { model: FOLLOW_UP_MODEL, max_tokens: FOLLOW_UP_MAX_TOKENS, system, messages },
      { timeout: Math.max(15_000, left) },
    )
    const usage = parseUsage(msg.usage, 0)
    promptTokens += totalPromptTokens(usage)
    outputTokens += usage.outputTokens
    cost += calculateCost(usage, SONNET_PRICING)
    return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
  }

  let text = ''
  let problem: string | null = null
  let failure: string | null = null
  try {
    text = await call([{ role: 'user', content: userText }])
    problem = followUpProblem(text)
    // One corrective re-prompt, only with time left for it.
    if (problem && Date.now() - startedAt < SOFT_DEADLINE_MS - 40_000) {
      text = await call([
        { role: 'user', content: userText },
        { role: 'assistant', content: text || '(empty)' },
        { role: 'user', content: `${problem} Write the whole Follow-Up Decision Support again, in the RESPONSE FORMAT your instructions give.` },
      ])
      problem = followUpProblem(text)
    }
  } catch (err) {
    console.error('Sales coach follow-up error:', err)
    failure = 'The follow-up recommendations could not be written. Please try again.'
  }
  if (!failure && problem) failure = 'The follow-up recommendations came back incomplete. Please try again.'

  const opTokens = promptTokens + outputTokens
  const totals = {
    tokens_input: (n.tokens_input || 0) + promptTokens,
    tokens_output: (n.tokens_output || 0) + outputTokens,
    tokens_total: (n.tokens_total || 0) + opTokens,
    cost_usd: Number(n.cost_usd || 0) + cost,
  }

  let support: SalesCoachFollowUpSupport | null = null
  let stale = false
  if (!failure) {
    support = {
      text,
      generated_at: new Date().toISOString(),
      model: FOLLOW_UP_MODEL,
      prompt_updated_at: prompt.updatedAt,
      playbook_updated_at: knowledge.versions.followup_playbook ?? null,
    }
    // Saved only onto the card it was written from: a card re-run meanwhile
    // (updated_at moved) keeps its own state, and the spend is still billed.
    const { data: saved } = await supabaseAdmin
      .from('sales_coach_negotiations')
      .update({ report_card: { ...n.report_card, follow_up_support: support }, ...totals })
      .eq('id', n.id)
      .eq('updated_at', n.updated_at)
      .select('id')
    stale = !saved || saved.length === 0
  }
  if (opTokens > 0 && (failure || stale)) {
    await supabaseAdmin.from('sales_coach_negotiations').update(totals).eq('id', n.id)
  }
  if (opTokens > 0) {
    await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: opTokens })
    await logUsageEvent({
      userId: user.id,
      workflow: 'sales_coach_follow_up',
      sourceId: n.id,
      model: FOLLOW_UP_MODEL,
      tokensInput: promptTokens,
      tokensOutput: outputTokens,
      tokensTotal: opTokens,
      costUsd: cost,
      ...(failure ? { status: 'error' as const, error: problem || failure } : {}),
    })
  }

  if (failure) return NextResponse.json({ error: failure, retryable: true }, { status: 502 })
  if (stale) {
    return NextResponse.json({ error: 'The Report Card changed while the recommendations were being written. Please try again.' }, { status: 409 })
  }
  return NextResponse.json({ followUpSupport: support })
}
