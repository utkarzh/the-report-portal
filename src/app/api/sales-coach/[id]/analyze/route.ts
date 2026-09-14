import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import {
  calculateCost,
  parseUsage,
  totalPromptTokens,
  SALES_COACH_ANALYZE_RESERVE,
  SONNET_PRICING,
} from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import {
  REPORT_CARD_CONTRACT,
  REPORT_CARD_OUTPUT_SCHEMA,
  applyDiscrepancyRules,
  pickTranscript,
  renderReportCardMarkdown,
  validateReportCard,
} from '@/lib/sales-coach'
import { buildNegotiationContext, buildTranscriptBlock, loadKnowledgeBundle } from '@/lib/sales-coach-context'
import type { SalesCoachNegotiation } from '@/types'

export const runtime = 'nodejs'
// One long call: ~30k tokens of doctrine + a whole transcript in, a structured
// card out. Raise the ceiling so persist/billing after the call always runs.
export const maxDuration = 300

const ANALYSIS_MODEL = 'claude-sonnet-4-6'
// Abort the model call this long into the request so the persist + billing
// below always runs before Vercel's 300s hard cap.
const SOFT_DEADLINE_MS = 270_000
// A complete card is ~4-8k tokens. At Sonnet's ~50 tok/s anything past ~13k
// would hit the soft deadline anyway, so cap lower and fail with a clear
// "cut off" message instead of a timeout.
const MAX_OUTPUT_TOKENS = 12000
// A row stuck at 'analyzing' longer than this is a dead run (the function was
// killed) and may be re-run.
const STALE_ANALYZING_MS = 8 * 60_000

const ANALYST_PERSONA = `You are the TRC Sales Coach — an experienced TRC Project Director reviewing a real sales negotiation that a Sales Executive ran with a company CEO or senior official immediately after an editorial interview. You produce the formal REPORT CARD: an evidence-based, criterion-by-criterion evaluation of how the negotiation was executed against TRC doctrine, followed by deeper coaching feedback.

Authority order for everything you judge: the Sales Coach Project Prompt is the highest authority, then the Manual (TRC Overcoming Objections), then the TRC Sales Coaching Method. The Successful Negotiation Examples are for pattern recognition ONLY — never import their facts, numbers or dialogue into this negotiation.

Use the submission context to identify who is speaking (which speaker is the Sales Executive, which is the buyer) and to interpret the recording. Read the whole transcript before judging anything. Ground every verdict in what was actually said.`

interface Params {
  params: { id: string }
}

// POST /api/sales-coach/[id]/analyze — generate (or regenerate) the Report
// Card (US-039/040/041/048). SSE so the connection stays alive for the length
// of the call: `{status}` → `{ping}`… → `{done, negotiation}` | `{error}`.
export async function POST(_request: NextRequest, { params }: Params) {
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
  // Token gate BEFORE any API cost (US-006 pattern).
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < SALES_COACH_ANALYZE_RESERVE) {
    return NextResponse.json({ error: 'Not enough token budget remaining to generate a Report Card' }, { status: 402 })
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
  if (!transcript) {
    return NextResponse.json({ error: 'This negotiation has no transcript yet. Transcribe the audio first.' }, { status: 409 })
  }
  if (n.stage === 'transcribing') {
    return NextResponse.json({ error: 'The audio is still being transcribed.' }, { status: 409 })
  }
  if (n.stage === 'analyzing' && Date.now() - new Date(n.updated_at).getTime() < STALE_ANALYZING_MS) {
    return NextResponse.json({ error: 'A Report Card is already being generated for this negotiation.' }, { status: 409 })
  }

  const knowledge = await loadKnowledgeBundle()

  await supabaseAdmin
    .from('sales_coach_negotiations')
    .update({ stage: 'analyzing', error: null })
    .eq('id', n.id)

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()
  const requestStartedAt = Date.now()

  // Static across every negotiation → one cache breakpoint at the end of the
  // system prompt caches persona + doctrine + contract (~30k tokens) for 1h.
  const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${ANALYST_PERSONA}\n\n=== TRC KNOWLEDGE DOCUMENTS (your doctrine) ===\n\n${knowledge.block}` },
    { type: 'text', text: REPORT_CARD_CONTRACT, cache_control: CACHE_1H },
  ]
  const submission = `${buildNegotiationContext(n)}\n\n${buildTranscriptBlock(n)}\n\nProduce the Report Card for this negotiation now.`

  const stream = new ReadableStream({
    async start(controller) {
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
      const heartbeat = setInterval(() => send({ ping: true }), 10_000)

      let promptTokens = 0
      let outputTokens = 0
      let cost = 0
      let activeStream: ReturnType<typeof anthropic.messages.stream> | null = null
      let aborted = false
      const deadline = setTimeout(() => {
        aborted = true
        activeStream?.abort()
      }, SOFT_DEADLINE_MS)

      // One model pass: streams (so the SDK never times out on a long card),
      // returns the JSON text, and adds its usage to the running totals.
      async function runPass(messages: Anthropic.MessageParam[]): Promise<string> {
        // No extended thinking here, deliberately: on a 1,400-word transcript
        // adaptive thinking spent the ENTIRE 16k output budget reasoning (318s,
        // stop_reason max_tokens, zero JSON) — past the soft deadline, so the
        // run would fail and still bill. Without it a full card is ~4-8k tokens
        // in 1-3 minutes, like every other Sonnet call in this app.
        const s = anthropic.messages.stream({
          model: ANALYSIS_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system,
          messages,
          output_config: { format: { type: 'json_schema', schema: REPORT_CARD_OUTPUT_SCHEMA } },
        })
        activeStream = s
        const final = await s.finalMessage()
        activeStream = null
        const usage = parseUsage(final.usage, 0)
        promptTokens += totalPromptTokens(usage)
        outputTokens += usage.outputTokens
        cost += calculateCost(usage, SONNET_PRICING)
        if (final.stop_reason === 'max_tokens') throw new Error('The Report Card was cut off before it finished. Please try again.')
        return final.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      }

      function tryParse(text: string): { card?: unknown; error?: string } {
        try {
          return { card: JSON.parse(text) }
        } catch {
          return { error: 'Response was not valid JSON' }
        }
      }

      const ctx = { company: n.company || '', declaredOutcome: n.declared_outcome }

      try {
        send({ status: 'analyzing' })

        const firstText = await runPass([{ role: 'user', content: submission }])
        let parsed = tryParse(firstText)
        let result = parsed.card !== undefined
          ? validateReportCard(parsed.card, ctx)
          : { ok: false, problems: [parsed.error || 'Unparseable'], normalized: undefined }

        // One corrective pass only (US-039): send the problems back with the
        // model's own output and ask for the corrected full card.
        const timeLeft = SOFT_DEADLINE_MS - (Date.now() - requestStartedAt)
        if (!result.ok && !aborted && timeLeft > 90_000) {
          send({ status: 'correcting' })
          const fixText = await runPass([
            { role: 'user', content: submission },
            { role: 'assistant', content: firstText },
            {
              role: 'user',
              content: `Your Report Card failed validation:\n- ${result.problems.join('\n- ')}\n\nReturn the complete corrected Report Card JSON (all fields), fixing every problem listed and changing nothing else.`,
            },
          ])
          parsed = tryParse(fixText)
          result = parsed.card !== undefined
            ? validateReportCard(parsed.card, ctx)
            : { ok: false, problems: [parsed.error || 'Unparseable'], normalized: undefined }
        }

        clearTimeout(deadline)
        const totalTokens = promptTokens + outputTokens

        if (!result.ok || !result.normalized) {
          const message = 'The Report Card came back in an unexpected shape. Please run it again.'
          console.error('Sales coach report card validation failed:', result.problems)
          await supabaseAdmin
            .from('sales_coach_negotiations')
            .update({
              stage: 'failed',
              error: message,
              tokens_input: (n.tokens_input || 0) + promptTokens,
              tokens_output: (n.tokens_output || 0) + outputTokens,
              tokens_total: (n.tokens_total || 0) + totalTokens,
              cost_usd: Number(n.cost_usd || 0) + cost,
            })
            .eq('id', n.id)
          await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
          await logUsageEvent({
            userId: user.id,
            workflow: 'sales_coach_report_card',
            sourceId: n.id,
            model: ANALYSIS_MODEL,
            tokensInput: promptTokens,
            tokensOutput: outputTokens,
            tokensTotal: totalTokens,
            costUsd: cost,
            status: 'error',
            error: `Validation failed: ${result.problems.slice(0, 5).join('; ')}`,
          })
          send({ error: message })
          return
        }

        const card = applyDiscrepancyRules(result.normalized)
        const markdown = renderReportCardMarkdown(card)
        const uvCriteria = card.criteria.filter((c) => c.verdict === 'uv').map((c) => c.key)

        // Persist FIRST — must run even if the client dropped.
        const { data: updated } = await supabaseAdmin
          .from('sales_coach_negotiations')
          .update({
            report_card: card,
            report_card_markdown: markdown,
            ai_assessed_position: card.assessed_position,
            execution_score: card.execution_score,
            execution_denominator: card.execution_denominator,
            uv_criteria: uvCriteria,
            discrepancy: card.discrepancy ?? null,
            management_review: card.management_review,
            project_prompt_snapshot: knowledge.projectPrompt || null,
            knowledge_versions: knowledge.versions,
            model_used: ANALYSIS_MODEL,
            stage: 'complete',
            error: null,
            tokens_input: (n.tokens_input || 0) + promptTokens,
            tokens_output: (n.tokens_output || 0) + outputTokens,
            tokens_total: (n.tokens_total || 0) + totalTokens,
            cost_usd: Number(n.cost_usd || 0) + cost,
          })
          .eq('id', n.id)
          .select('*')
          .single()

        await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
        await logUsageEvent({
          userId: user.id,
          workflow: 'sales_coach_report_card',
          sourceId: n.id,
          model: ANALYSIS_MODEL,
          tokensInput: promptTokens,
          tokensOutput: outputTokens,
          tokensTotal: totalTokens,
          costUsd: cost,
        })

        send({ done: true, negotiation: updated })
      } catch (err) {
        clearTimeout(deadline)
        console.error('Sales coach analysis error:', err)
        const message = aborted
          ? 'The Report Card took too long to generate. Please try again.'
          : 'The Report Card could not be generated. Please try again.'
        const totalTokens = promptTokens + outputTokens
        await supabaseAdmin
          .from('sales_coach_negotiations')
          .update({
            stage: 'failed',
            error: message,
            tokens_input: (n.tokens_input || 0) + promptTokens,
            tokens_output: (n.tokens_output || 0) + outputTokens,
            tokens_total: (n.tokens_total || 0) + totalTokens,
            cost_usd: Number(n.cost_usd || 0) + cost,
          })
          .eq('id', n.id)
        if (totalTokens > 0) {
          await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
        }
        await logUsageEvent({
          userId: user.id,
          workflow: 'sales_coach_report_card',
          sourceId: n.id,
          model: ANALYSIS_MODEL,
          tokensInput: promptTokens,
          tokensOutput: outputTokens,
          tokensTotal: totalTokens,
          costUsd: cost,
          status: 'error',
          error: err instanceof Error ? err.message : 'Analysis failed',
        })
        send({ error: message })
      } finally {
        clearInterval(heartbeat)
        clearTimeout(deadline)
        sendRaw('[DONE]')
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
