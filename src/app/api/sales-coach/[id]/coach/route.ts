import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import {
  calculateCost,
  parseUsage,
  totalPromptTokens,
  SALES_COACH_COACH_RESERVE,
  SONNET_PRICING,
} from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { pickTranscript } from '@/lib/sales-coach'
import { loadKnowledgeBundle } from '@/lib/sales-coach-context'
import { TEXT_FORMAT, VOICE_FORMAT, buildCoachSystemText } from '@/lib/sales-coach-coach-prompt'
import type { SalesCoachNegotiation } from '@/types'

const COACH_MODEL = 'claude-sonnet-4-6'

// A coaching turn is short, but a long transcript is re-sent as grounding each
// turn — raise the ceiling so the persist/billing after the stream always runs.
export const maxDuration = 300

// POST /api/sales-coach/[id]/coach — one coaching turn. Persists the user
// message, streams a grounded reply (SSE), then persists the assistant message
// and bills. Mirrors the transcript translate/refine pattern: pre-flight token
// gate, persist-first, then report usage.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit, can_access_sales_negotiation_coach')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_sales_negotiation_coach) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const message = typeof (body as { message?: unknown }).message === 'string'
    ? (body as { message: string }).message.trim()
    : ''
  if (!message) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  if (message.length > 4000) {
    return NextResponse.json({ error: 'Message too long' }, { status: 400 })
  }
  const mode = (body as { mode?: unknown }).mode === 'voice' ? 'voice' : 'text'

  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < SALES_COACH_COACH_RESERVE
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining to continue coaching' },
      { status: 402 },
    )
  }

  const { data: neg } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!neg) return NextResponse.json({ error: 'Negotiation not found' }, { status: 404 })
  const n = neg as SalesCoachNegotiation
  if (n.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const transcript = pickTranscript(n)
  if (!transcript && !n.report_card) {
    return NextResponse.json(
      { error: 'This negotiation has no transcript or Report Card to coach on yet.' },
      { status: 409 },
    )
  }

  // Knowledge docs in fixed authority order (US-038) — same bundle the
  // Report Card analysis reasons from.
  const knowledge = await loadKnowledgeBundle()

  // Prior turns, oldest first.
  const { data: history } = await supabaseAdmin
    .from('sales_coach_messages')
    .select('role, content')
    .eq('negotiation_id', n.id)
    .order('created_at', { ascending: true })

  // Same persona, documents, card and transcript as the live voice coach.
  // Points in the card for admins only, as on screen.
  const systemText = buildCoachSystemText(n, knowledge, {
    format: mode === 'voice' ? VOICE_FORMAT : TEXT_FORMAT,
    showPoints: profile.role === 'admin',
  })

  // The whole system is stable across a conversation, so cache it (1h) — repeat
  // turns re-read the transcript/docs from cache instead of paying full input.
  const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }
  const systemBlocks = [{ type: 'text' as const, text: systemText, cache_control: CACHE_1H }]

  const priorMessages = (history || []).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  const messages = [...priorMessages, { role: 'user' as const, content: message }]

  // Persist the user turn immediately (before the model call) so a mid-stream
  // disconnect never loses what the executive said.
  await supabaseAdmin.from('sales_coach_messages').insert({
    negotiation_id: n.id,
    role: 'user',
    content: message,
  })

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ''
      let clientConnected = true
      const sendRaw = (data: string) => {
        if (!clientConnected) return
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {
          clientConnected = false
        }
      }
      const send = (payload: unknown) => sendRaw(JSON.stringify(payload))

      try {
        const claudeStream = anthropic.messages.stream({
          model: COACH_MODEL,
          // Text turns may carry a drafted email or a prioritised action plan.
          max_tokens: mode === 'voice' ? 700 : 2000,
          system: systemBlocks,
          messages,
        })

        for await (const event of claudeStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text
            send({ text: event.delta.text })
          }
        }

        const finalMsg = await claudeStream.finalMessage()
        const usage = parseUsage(finalMsg.usage, 0)
        const promptTokens = totalPromptTokens(usage)
        const opTokens = promptTokens + usage.outputTokens
        const opCost = calculateCost(usage, SONNET_PRICING)

        // Persist FIRST — must run even if the client dropped.
        await supabaseAdmin.from('sales_coach_messages').insert({
          negotiation_id: n.id,
          role: 'assistant',
          content: fullText,
        })

        await supabaseAdmin
          .from('sales_coach_negotiations')
          .update({
            tokens_input: (n.tokens_input || 0) + promptTokens,
            tokens_output: (n.tokens_output || 0) + usage.outputTokens,
            tokens_total: (n.tokens_total || 0) + opTokens,
            cost_usd: Number(n.cost_usd || 0) + opCost,
          })
          .eq('id', n.id)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user.id,
          p_tokens: opTokens,
        })

        await logUsageEvent({
          userId: user.id,
          workflow: 'sales_coach_coach',
          sourceId: n.id,
          model: COACH_MODEL,
          tokensInput: promptTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: opTokens,
          costUsd: opCost,
        })

        sendRaw('[DONE]')
      } catch (err) {
        console.error('Sales coach stream error:', err)
        send({ error: 'The coach could not reply. Please try again.' })
      } finally {
        try {
          controller.close()
        } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
