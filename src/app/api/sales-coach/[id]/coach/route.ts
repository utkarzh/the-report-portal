import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import {
  calculateCost,
  parseUsage,
  totalPromptTokens,
  SALES_COACH_COACH_RESERVE,
  SONNET_PRICING,
} from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { SALES_COACH_KNOWLEDGE_DOCS, SALES_COACH_OUTCOMES } from '@/lib/sales-coach'
import type { SalesCoachNegotiation, SalesCoachKnowledgeDoc } from '@/types'

const COACH_MODEL = 'claude-sonnet-4-6'

// A coaching turn is short, but a long transcript is re-sent as grounding each
// turn — raise the ceiling so the persist/billing after the stream always runs.
export const maxDuration = 300

// The coaching persona (US-043). Written for a SPOKEN, natural back-and-forth:
// the sales exec can talk to this coach with their microphone and hear it reply,
// so answers stay conversational and concise rather than long formatted essays.
const COACH_PERSONA = `You are the TRC Sales Coach — an experienced, warm negotiation coach speaking one-to-one with a Sales Executive about a real negotiation they just ran. You are having a spoken conversation: the executive talks to you and hears your replies aloud.

How you speak:
- Talk like a real coach in the room — warm, direct, encouraging but honest. Never robotic.
- Keep replies short and conversational: usually 2–5 sentences, one idea at a time. This is a dialogue, not a report.
- Use plain spoken language. Do NOT use markdown, bullet points, headings, or emoji — your words are read aloud.
- Ground everything in what actually happened. When it helps, briefly quote or paraphrase a specific moment from the transcript ("when you said …").
- Lean on the TRC knowledge documents below for doctrine — the planteo build-up formula, objection handling, the coaching method — but explain it in your own natural words.
- Usually end by inviting the executive to go deeper or try a rephrasing, so the conversation keeps flowing. Ask one question at a time.
- Coach, don't lecture. Celebrate what they did well before working on what to improve.

Authority: the Project Prompt is your highest authority, then the Manual, then the Method. The Successful Negotiation Examples are for pattern recognition ONLY — never import their specific facts, numbers, or dialogue into this negotiation. Treat the declared outcome and the AI-assessed position as distinct; do not collapse them.`

function buildNegotiationContext(n: SalesCoachNegotiation): string {
  const outcomeLabel =
    SALES_COACH_OUTCOMES.find((o) => o.value === n.declared_outcome)?.label || n.declared_outcome || 'Not declared'
  const reps = n.company_reps?.map((p) => [p.name, p.role].filter(Boolean).join(' — ')).filter(Boolean) || []
  const trc = n.trc_members?.map((p) => [p.name, p.role].filter(Boolean).join(' — ')).filter(Boolean) || []
  const details = n.outcome_details && Object.keys(n.outcome_details).length > 0
    ? JSON.stringify(n.outcome_details, null, 2)
    : null

  const lines = [
    '--- NEGOTIATION CONTEXT (submission metadata) ---',
    `Submitted by: ${n.submitted_by_name || '—'}`,
    `Company: ${n.company || '—'}`,
    `Country: ${n.country || '—'}`,
    `Media / publication: ${n.media_publication || '—'}`,
    `Interviewee: ${[n.interviewee_name, n.interviewee_position].filter(Boolean).join(' — ') || '—'}`,
    `Company representatives: ${reps.length ? reps.join('; ') : '—'}`,
    `TRC team members: ${trc.length ? trc.join('; ') : '—'}`,
    `Declared outcome: ${outcomeLabel}`,
  ]
  if (details) lines.push(`Outcome details:\n${details}`)
  if (n.other_comments) lines.push(`Other comments from the executive: ${n.other_comments}`)
  return lines.join('\n')
}

// POST /api/sales-coach/[id]/coach — one coaching turn. Persists the user
// message, streams a grounded reply (SSE), then persists the assistant message
// and bills. Mirrors the transcript translate/refine pattern: pre-flight token
// gate, persist-first, then report usage.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const transcript = (n.system_transcript || n.uploaded_transcript || '').trim()
  if (!transcript && !n.report_card) {
    return NextResponse.json(
      { error: 'This negotiation has no transcript or Report Card to coach on yet.' },
      { status: 409 },
    )
  }

  // Knowledge docs in fixed authority order (US-038).
  const { data: docs } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .select('doc_key, content')
  const byKey = new Map((docs || []).map((d) => [d.doc_key, (d as Partial<SalesCoachKnowledgeDoc>).content || '']))
  const knowledgeBlock = SALES_COACH_KNOWLEDGE_DOCS.map(({ key, label }, i) => {
    const content = (byKey.get(key) || '').trim()
    const authority = i === 0 ? ' (HIGHEST AUTHORITY)' : key === 'examples' ? ' (pattern recognition only)' : ''
    return `===== ${label}${authority} =====\n${content || '(not provided)'}`
  }).join('\n\n')

  // Prior turns, oldest first.
  const { data: history } = await supabaseAdmin
    .from('sales_coach_messages')
    .select('role, content')
    .eq('negotiation_id', n.id)
    .order('created_at', { ascending: true })

  const reportCardBlock = n.report_card
    ? `--- REPORT CARD (already produced for this negotiation) ---\n${n.report_card_markdown?.trim() || JSON.stringify(n.report_card, null, 2)}`
    : '--- REPORT CARD ---\nThe formal Report Card has not been generated yet. Coach directly from the transcript and context.'

  const systemText = [
    COACH_PERSONA,
    '=== TRC KNOWLEDGE DOCUMENTS (your doctrine) ===',
    knowledgeBlock,
    buildNegotiationContext(n),
    reportCardBlock,
    transcript
      ? `--- NEGOTIATION TRANSCRIPT ---\n${transcript}`
      : '--- NEGOTIATION TRANSCRIPT ---\n(No transcript available; coach from the context and Report Card.)',
  ].join('\n\n')

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
          max_tokens: 1000,
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
