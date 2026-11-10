import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { logUsageEvent } from '@/lib/claude/usage'
import { VOICE_MODEL, voiceUsageCost, voiceUsageTokens, type VoiceUsage } from '@/lib/sales-coach-voice'
import type { SalesCoachNegotiation } from '@/types'

const MAX_TURNS = 20
const MAX_TURN_CHARS = 8000
const MAX_USAGE_ENTRIES = 40
// Far above one response; anything bigger is not a real count.
const MAX_TOKENS_PER_FIELD = 400_000

const USAGE_FIELDS: (keyof VoiceUsage)[] = ['textInput', 'audioInput', 'cachedText', 'cachedAudio', 'textOutput', 'audioOutput']

// POST /api/sales-coach/[id]/voice-turns — { turns, usage } from a live voice
// call: what was said (from the Realtime transcripts) is saved into the same
// coaching chat as typed turns, so the text coach and later calls see it, and
// each response's usage is billed like a text coaching turn (negotiation
// totals, the user's token budget, the usage ledger). The usage counts come
// from the browser, which is the only side that sees the call's events.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const body = await request.json().catch(() => null) as { turns?: unknown; usage?: unknown } | null
  const turns = (Array.isArray(body?.turns) ? body!.turns : [])
    .slice(0, MAX_TURNS)
    .flatMap((t) => {
      const role = (t as { role?: unknown })?.role
      const content = typeof (t as { content?: unknown })?.content === 'string' ? (t as { content: string }).content.trim().slice(0, MAX_TURN_CHARS) : ''
      return (role === 'user' || role === 'assistant') && content ? [{ role, content }] : []
    })
  const usage: VoiceUsage[] = (Array.isArray(body?.usage) ? body!.usage : [])
    .slice(0, MAX_USAGE_ENTRIES)
    .map((u) => Object.fromEntries(USAGE_FIELDS.map((f) => {
      const v = Number((u as Record<string, unknown>)?.[f])
      return [f, Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), MAX_TOKENS_PER_FIELD) : 0]
    })) as unknown as VoiceUsage)
  if (turns.length === 0 && usage.length === 0) return NextResponse.json({ ok: true })

  const { data: profile } = await supabaseAdmin.from('profiles').select('id, role, status').eq('id', user.id).single()
  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  const { data: neg } = await supabaseAdmin.from('sales_coach_negotiations').select('*').eq('id', params.id).single()
  if (!neg) return NextResponse.json({ error: 'Negotiation not found' }, { status: 404 })
  const n = neg as SalesCoachNegotiation
  if (n.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (turns.length > 0) {
    // One insert shares one NOW(), and the chat is ordered by created_at, so
    // each turn gets its own millisecond to keep the order it was spoken in.
    const base = Date.now()
    const { error } = await supabaseAdmin.from('sales_coach_messages').insert(
      turns.map((t, i) => ({ negotiation_id: n.id, role: t.role, content: t.content, created_at: new Date(base + i).toISOString() })),
    )
    if (error) {
      console.error('Sales coach voice: could not save turns', error)
      return NextResponse.json({ error: 'Could not save the call.', retryable: true }, { status: 500 })
    }
  }

  if (usage.length > 0) {
    const tokens = usage.reduce((acc, u) => {
      const t = voiceUsageTokens(u)
      return { input: acc.input + t.input, output: acc.output + t.output }
    }, { input: 0, output: 0 })
    const cost = usage.reduce((acc, u) => acc + voiceUsageCost(u), 0)
    const total = tokens.input + tokens.output

    await supabaseAdmin.from('sales_coach_negotiations').update({
      tokens_input: (n.tokens_input || 0) + tokens.input,
      tokens_output: (n.tokens_output || 0) + tokens.output,
      tokens_total: (n.tokens_total || 0) + total,
      cost_usd: Number(n.cost_usd || 0) + cost,
    }).eq('id', n.id)
    await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: total })
    await logUsageEvent({
      userId: user.id,
      workflow: 'sales_coach_voice',
      sourceId: n.id,
      model: VOICE_MODEL,
      tokensInput: tokens.input,
      tokensOutput: tokens.output,
      tokensTotal: total,
      costUsd: cost,
    })
  }

  return NextResponse.json({ ok: true })
}
