import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { SALES_COACH_COACH_RESERVE } from '@/lib/claude/tokens'
import { pickTranscript } from '@/lib/sales-coach'
import { loadKnowledgeBundle } from '@/lib/sales-coach-context'
import { buildCoachSystemText } from '@/lib/sales-coach-coach-prompt'
import {
  LIVE_VOICE_FORMAT, LIVE_VOICE_REMINDER, VOICE_MAX_SECONDS, VOICE_MODEL, VOICE_SECRET_TTL_SECONDS,
  callerBlock, conversationSoFarBlock, realtimeSessionConfig,
} from '@/lib/sales-coach-voice'
import type { SalesCoachNegotiation } from '@/types'

export const maxDuration = 30

// POST /api/sales-coach/[id]/voice-session — starts a live voice coaching call.
// Same access and budget checks as a text coaching turn, then mints a
// short-lived OpenAI Realtime client secret carrying the whole coaching prompt
// (persona, five TRC documents, Report Card, transcript, chat so far). The
// browser uses it to connect to OpenAI directly over WebRTC; the standard API
// key never leaves the server. No AI cost here: the call is billed turn by turn
// through /voice-turns.
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'Live voice coaching is not set up on this server.' }, { status: 503 })
  }

  // All four reads at once: preparing a call sits in front of the executive
  // hearing the coach. Nothing is returned until the checks below pass.
  const [{ data: profile }, { data: neg }, knowledge, { data: history }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, full_name, role, status, tokens_used, token_limit, can_access_sales_negotiation_coach')
      .eq('id', user.id)
      .single(),
    supabaseAdmin.from('sales_coach_negotiations').select('*').eq('id', params.id).single(),
    loadKnowledgeBundle(),
    supabaseAdmin.from('sales_coach_messages').select('role, content').eq('negotiation_id', params.id).order('created_at', { ascending: true }),
  ])
  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_sales_negotiation_coach) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < SALES_COACH_COACH_RESERVE) {
    return NextResponse.json({ error: "You've reached your monthly AI limit, so a coaching call can't start." }, { status: 402 })
  }

  if (!neg) return NextResponse.json({ error: 'Negotiation not found' }, { status: 404 })
  const n = neg as SalesCoachNegotiation
  if (n.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!n.report_card && !pickTranscript(n)) {
    return NextResponse.json({ error: 'This negotiation has no transcript or Report Card to coach on yet.' }, { status: 409 })
  }

  const instructions = [
    buildCoachSystemText(n, knowledge, { format: LIVE_VOICE_FORMAT, showPoints: profile.role === 'admin' }),
    conversationSoFarBlock(history || []),
    callerBlock({ callerName: profile.full_name, isOwner: n.user_id === user.id, executiveName: n.submitted_by_name }),
    LIVE_VOICE_REMINDER,
  ].filter(Boolean).join('\n\n')

  try {
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        // Lets OpenAI tell users apart for abuse handling without our ids.
        'OpenAI-Safety-Identifier': createHash('sha256').update(user.id).digest('hex'),
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: VOICE_SECRET_TTL_SECONDS },
        session: realtimeSessionConfig(instructions),
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const body = await res.json().catch(() => null) as { value?: string; expires_at?: number; error?: { message?: string } } | null
    if (!res.ok || !body?.value) {
      console.error('Sales coach voice: client secret failed', res.status, body?.error?.message)
      return NextResponse.json({ error: 'The coach could not join the call. Please try again.', retryable: true }, { status: 502 })
    }
    return NextResponse.json({
      clientSecret: body.value,
      expiresAt: body.expires_at ?? null,
      model: VOICE_MODEL,
      maxSeconds: VOICE_MAX_SECONDS,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('Sales coach voice: client secret error', err)
    return NextResponse.json({ error: 'The coach could not join the call. Please try again.', retryable: true }, { status: 502 })
  }
}
