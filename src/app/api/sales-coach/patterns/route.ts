import { NextRequest, NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, SALES_COACH_PATTERN_RESERVE, SONNET_PRICING } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { isSalesCoachAdminEmail } from '@/lib/sales-coach-admins'
import { loadKnowledgeBundle } from '@/lib/sales-coach-context'
import {
  PATTERN_ANALYSIS_CONTRACT, PATTERN_ANALYST_PERSONA, PATTERN_SCOPES, cardsForScope, computePatternStats, isPatternScope,
  patternCardDigest, patternStatsBlock, scopeAvailable, toPatternSummary,
} from '@/lib/sales-coach-patterns'
import {
  PATTERN_TABLE, isMissingPatternTable, loadExecutiveCardRows, loadExecutiveName, loadPatternAnalyses,
} from '@/lib/sales-coach-patterns-server'

export const runtime = 'nodejs'
export const maxDuration = 300

const MODEL = 'claude-sonnet-4-6'
// Abort the model this long into the request, so billing and saving always
// run before Vercel's 300s cap.
const SOFT_DEADLINE_MS = 270_000
// The contract asks for ~700-1,100 words (~1.5k tokens); room to spare.
const MAX_OUTPUT_TOKENS = 5000
// More cards than this get the shorter digest, so "All" stays fast.
const FULL_DIGEST_MAX_CARDS = 12

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

// Sales Coach admins only (the email allowlist, like the rest of the Sales
// Coach admin area). A transient sign-in-service failure comes back as a
// retryable 503 from getApiUser, never as Forbidden.
async function requirePatternAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return { user: null, response: auth.response }
  if (!isSalesCoachAdminEmail(auth.user.email)) {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user: auth.user, response: null }
}

// GET /api/sales-coach/patterns?userId= — one executive's Report Cards (one
// per meeting, newest first, as light summaries) and their saved analyses.
export async function GET(request: NextRequest) {
  const auth = await requirePatternAdmin()
  if (!auth.user) return auth.response!

  const userId = request.nextUrl.searchParams.get('userId')
  if (!isUuid(userId)) return NextResponse.json({ error: 'Choose a Sales Executive.' }, { status: 400 })

  try {
    const [rows, history] = await Promise.all([loadExecutiveCardRows(userId), loadPatternAnalyses(userId)])
    return NextResponse.json(
      { cards: rows.map(toPatternSummary), analyses: history.analyses, historyAvailable: history.available },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('Sales coach patterns: load failed', err)
    return NextResponse.json({ error: 'Could not load the Report Cards.' }, { status: 500 })
  }
}

// POST /api/sales-coach/patterns { userId, scope } — reads that executive's
// last 5 / 10 / 20 / all Report Cards together and streams the pattern
// analysis. The cards are chosen here, never taken from the browser. SSE:
// {meta} → {text}… ({ping} every 10s) → {done, analysisId, saved} | {error}.
export async function POST(request: NextRequest) {
  const auth = await requirePatternAdmin()
  if (!auth.user) return auth.response!
  const user = auth.user

  const body = await request.json().catch(() => ({})) as { userId?: unknown; scope?: unknown }
  if (!isUuid(body.userId)) return NextResponse.json({ error: 'Choose a Sales Executive.' }, { status: 400 })
  if (!isPatternScope(body.scope)) return NextResponse.json({ error: 'Choose how many Report Cards to analyse.' }, { status: 400 })
  const subjectId = body.userId
  const scope = body.scope

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, status, tokens_used, token_limit')
    .eq('id', user.id)
    .single()
  if (!profile || profile.status === 'inactive') return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  // Checked before any cost, like every other AI step.
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < SALES_COACH_PATTERN_RESERVE) {
    return NextResponse.json({ error: "You've reached your monthly AI limit, so this analysis can't run." }, { status: 402 })
  }

  let allRows
  try {
    allRows = await loadExecutiveCardRows(subjectId)
  } catch (err) {
    console.error('Sales coach patterns: load failed', err)
    return NextResponse.json({ error: 'Could not load the Report Cards.' }, { status: 500 })
  }
  if (!scopeAvailable(scope, allRows.length)) {
    return NextResponse.json({ error: allRows.length ? `Only ${allRows.length} Report Cards are available for this person.` : 'This person has no Report Cards yet.' }, { status: 409 })
  }

  const rows = cardsForScope(allRows, scope)
  const chrono = [...rows].reverse()
  const stats = computePatternStats(rows.map(toPatternSummary))
  const [subjectName, knowledge] = await Promise.all([
    loadExecutiveName(subjectId, rows[0]?.submitted_by_name ?? null),
    loadKnowledgeBundle(),
  ])
  const firstName = subjectName.split(/\s+/)[0] || subjectName
  const scopeLabel = PATTERN_SCOPES.find((s) => s.id === scope)?.label ?? scope
  const compact = rows.length > FULL_DIGEST_MAX_CARDS

  // Persona + doctrine + contract are the same for every analysis: one 1h
  // cache breakpoint at the end of the system prompt.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${PATTERN_ANALYST_PERSONA}\n\n=== TRC KNOWLEDGE DOCUMENTS (your doctrine) ===\n\n${knowledge.block}` },
    { type: 'text', text: PATTERN_ANALYSIS_CONTRACT, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ]
  const userText = [
    '--- SALES EXECUTIVE ---',
    `Name: ${subjectName}`,
    `Report Cards provided: ${rows.length} (${scopeLabel === 'All' ? `all of them${allRows.length > rows.length ? `, the ${rows.length} most recent` : ''}` : scopeLabel.toLowerCase()}), oldest first. A meeting that was re-evaluated appears once, with its latest card.`,
    '',
    patternStatsBlock(stats),
    '',
    chrono.map((r, i) => patternCardDigest(r, i + 1, chrono.length, compact)).join('\n\n'),
    '',
    `Write the pattern analysis for ${firstName} now.`,
  ].join('\n')

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let clientConnected = true
      const send = (payload: unknown) => {
        if (!clientConnected) return
        try {
          controller.enqueue(encoder.encode(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`))
        } catch {
          clientConnected = false
        }
      }
      const heartbeat = setInterval(() => send({ ping: true }), 10_000)
      send({ meta: { subjectName, count: rows.length, scope, periodStart: stats.periodStart, periodEnd: stats.periodEnd } })

      const claude = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages: [{ role: 'user', content: userText }],
      })
      let aborted = false
      const deadline = setTimeout(() => {
        aborted = true
        try { claude.abort() } catch {}
      }, SOFT_DEADLINE_MS)

      let text = ''
      let startUsage: Record<string, unknown> = {}
      let outputTokens = 0
      let sawFinal = false
      let failure: string | null = null
      try {
        for await (const event of claude) {
          if (event.type === 'message_start') {
            startUsage = (event.message.usage ?? {}) as unknown as Record<string, unknown>
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            text += event.delta.text
            send({ text: event.delta.text })
          } else if (event.type === 'message_delta') {
            const du = event.usage as { output_tokens?: number } | undefined
            if (typeof du?.output_tokens === 'number') {
              outputTokens = du.output_tokens
              sawFinal = true
            }
          }
        }
      } catch (err) {
        if (!aborted) {
          console.error('Sales coach patterns: model call failed', err)
          failure = 'The analysis could not be completed. Please try again.'
        }
      } finally {
        clearTimeout(deadline)
      }
      if (aborted) failure = 'The analysis took too long and was stopped. Try fewer Report Cards.'

      // A pass cut short never sees its output count (it only arrives on
      // message_delta): recount what was received, so it's billed (CLAUDE.md,
      // Usage ledger).
      if (!sawFinal && text.trim()) {
        try {
          const counted = await anthropic.messages.countTokens({ model: MODEL, messages: [{ role: 'user', content: text }] })
          outputTokens = counted.input_tokens
        } catch (err) {
          console.error('Sales coach patterns: output-token recount failed', err)
        }
      }
      const usage = parseUsage({ ...startUsage, output_tokens: outputTokens }, 0)
      const promptTokens = totalPromptTokens(usage)
      const totalTokens = promptTokens + usage.outputTokens
      const cost = calculateCost(usage, SONNET_PRICING)

      let analysisId: string | null = null
      let saved = false
      let createdAt: string | null = null
      if (!failure && text.trim()) {
        const { data: row, error } = await supabaseAdmin
          .from(PATTERN_TABLE)
          .insert({
            subject_user_id: subjectId,
            subject_name: subjectName,
            scope,
            card_count: rows.length,
            negotiation_ids: rows.map((r) => r.id),
            period_start: stats.periodStart,
            period_end: stats.periodEnd,
            stats,
            output: text.trim(),
            model: MODEL,
            tokens_input: promptTokens,
            tokens_output: usage.outputTokens,
            cost_usd: cost,
            created_by: user.id,
            created_by_name: profile.full_name,
          })
          .select('id, created_at')
          .single()
        if (row) {
          analysisId = row.id
          createdAt = row.created_at
          saved = true
        } else if (error && !isMissingPatternTable(error)) {
          console.error('Sales coach patterns: save failed', error.message)
        }
      }

      if (totalTokens > 0) {
        await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
        await logUsageEvent({
          userId: user.id,
          workflow: 'sales_coach_pattern_analysis',
          sourceId: analysisId ?? subjectId,
          model: MODEL,
          tokensInput: promptTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: totalTokens,
          costUsd: cost,
          status: failure ? 'error' : 'success',
          error: failure,
        })
      }

      clearInterval(heartbeat)
      if (failure) send({ error: failure })
      else send({ done: true, analysisId, saved, createdAt })
      send('[DONE]')
      try { controller.close() } catch {}
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
