import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, GENERATION_TOKEN_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

// Capped to keep per-generation token usage in check. Each web search injects
// its full result set back into the context window, so every extra search adds
// thousands of input tokens. 7 targeted searches keep coverage high while
// roughly halving the token blow-out we saw with an uncapped (~10–15 search) run.
const MAX_WEB_SEARCHES = 7
const WEB_SEARCH_TOOL: WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: MAX_WEB_SEARCHES,
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < GENERATION_TOKEN_RESERVE
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining for another generation' },
      { status: 402 },
    )
  }

  const body = await request.json()
  const { sessionId, additionalPrompt } = body as {
    sessionId?: string
    additionalPrompt?: string
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const extra = (additionalPrompt || '').trim()

  const { data: session } = await supabaseAdmin
    .from('research_sessions')
    .select('id, user_id, full_name, title_position, company_org, country_focus, publication, media_partner_country, general_prompt_snapshot, category_prompt_snapshot')
    .eq('id', sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  if (session.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const systemPrompt = session.general_prompt_snapshot || ''
  const categoryPrompt = session.category_prompt_snapshot || ''
  const subjectDetails = `--- SUBJECT DETAILS ---
Full Name: ${session.full_name}
Title / Position: ${session.title_position}
Company / Organization / Ministry: ${session.company_org}
Country in Focus: ${session.country_focus}
Publication: ${session.publication}
Media Partner Country: ${session.media_partner_country}`

  // 1-hour TTL keeps the prefix hot across users for shared general/category prompts.
  // The cache invalidates naturally when an admin saves a new prompt version (the
  // text changes → new cache key → old entry expires unused).
  const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }

  // System-level search policy. Editorial team requires the absolute freshest
  // data, but searches are capped (see MAX_WEB_SEARCHES) to control token cost —
  // so each query must be high-yield. Today's date is injected so the model
  // anchors on the real current year instead of its training cut-off.
  const now = new Date()
  const currentYear = now.getFullYear()
  const lastYear = currentYear - 1
  const todayStr = now.toISOString().slice(0, 10)
  const SEARCH_POLICY = `--- WEB SEARCH POLICY (MANDATORY) ---
TODAY'S DATE IS ${todayStr}. The current year is ${currentYear}. Your training data is OUT OF DATE and you must assume anything you "remember" may have changed.

RECENCY IS THE #1 PRIORITY. The editorial team needs ${currentYear} information. Data from 2024 or earlier is STALE and is a critical failure unless it is clearly historical/biographical background. Treat any unverified fact older than ${lastYear} as suspect and re-verify it with a fresh search.

SEARCH QUERY RULES:
- Append a recency qualifier to EVERY query — e.g. "${currentYear}", "latest", "this year", or an explicit month/year. Never run an undated query for current facts.
- When results look old, add "${currentYear}" (and if needed "${lastYear}") and search again. Discard sources that only describe pre-${lastYear} states unless used as labelled background.
- Always check the publication date of a source before trusting it. Prefer the most recent. Reject ${currentYear === 2026 ? '2023/2024' : 'older'} articles as the basis for "current" claims.

You have a budget of ${MAX_WEB_SEARCHES} web searches — spend them well. Prioritise, in order:
1. Current role, title, and organization RIGHT NOW (${currentYear}) — verify, never assume
2. Appointments, departures, promotions, board changes in the last 12 months
3. Latest financials / results and any ${currentYear} M&A, deals, partnerships, funding
4. Recent news, regulatory actions, lawsuits, controversies (last 12 months)
5. Public statements, interviews, strategic initiatives by the subject (${lastYear}–${currentYear})
6. Country-focus context — relevant ${currentYear} political/economic/regulatory shifts

Batch related needs into a single well-targeted query rather than many narrow ones, since the search budget is limited. Re-run a query only when freshness or accuracy genuinely demands it.

OUTPUT RULES:
- Cite source URLs for EVERY factual claim about the subject, with the publication date where available
- Every claim about the subject's CURRENT situation must be backed by a ${lastYear}–${currentYear} web_search result, not training data
- If something cannot be verified, write N/A — never fall back to old training-data assumptions
- Training data is acceptable ONLY for clearly-labelled pre-${lastYear} historical/biographical background`

  const systemBlocks = [
    { type: 'text' as const, text: SEARCH_POLICY },
    ...(systemPrompt
      ? [{ type: 'text' as const, text: systemPrompt, cache_control: CACHE_1H }]
      : []),
  ]

  const userContentBlocks = [
    {
      type: 'text' as const,
      text: categoryPrompt,
      cache_control: CACHE_1H,
    },
    {
      type: 'text' as const,
      text: extra
        ? `\n\n${subjectDetails}\n\n--- ADDITIONAL CONTEXT FROM USER ---\n${extra}`
        : `\n\n${subjectDetails}`,
    },
  ]

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ''
      let seenToolUse = false
      let webSearchCount = 0
      // Once the client navigates away the controller is closed and enqueue()
      // throws. We must NOT let that abort the run — the generation has to
      // finish and persist regardless, otherwise the work is lost forever.
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
        // Mark as generating so a user who returns mid-run sees "Generating…".
        await supabaseAdmin
          .from('research_sessions')
          .update({ status: 'generating' })
          .eq('id', session!.id)

        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 8192,
          system: systemBlocks,
          messages: [{ role: 'user', content: userContentBlocks }],
          tools: [WEB_SEARCH_TOOL],
        })

        for await (const event of claudeStream) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              seenToolUse = true
              if (event.content_block.name === 'web_search') webSearchCount += 1
              send({ status: 'web_search_start' })
            } else if (event.content_block.type === 'text' && seenToolUse) {
              send({ status: 'generating' })
            }
          }

          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            fullText += event.delta.text
            send({ text: event.delta.text })
          }
        }

        const finalMsg = await claudeStream.finalMessage()
        // Prefer the server-reported web_search count when available; fall back to the
        // count we tallied from stream events.
        const reportedSearches =
          (finalMsg.usage as { server_tool_use?: { web_search_requests?: number } })
            .server_tool_use?.web_search_requests
        const searches = reportedSearches ?? webSearchCount

        const usage = parseUsage(finalMsg.usage, searches)
        const promptTokens = totalPromptTokens(usage)
        const totalTokens = promptTokens + usage.outputTokens
        const cost = calculateCost(usage)

        // Persist FIRST — this is the part that must never be skipped, even if
        // the client is gone. The SSE events below are best-effort.
        await supabaseAdmin
          .from('research_sessions')
          .update({
            initial_output: fullText,
            tokens_input: promptTokens,
            tokens_output: usage.outputTokens,
            tokens_total: totalTokens,
            web_searches: searches,
            cost_usd: cost,
            status: 'complete',
          })
          .eq('id', session!.id)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user!.id,
          p_tokens: totalTokens,
        })

        // Append to the usage ledger — the source of truth for analytics. Unlike
        // the session row (overwritten on each regenerate), this is immutable, so
        // every regeneration is counted.
        await logUsageEvent({
          userId: user!.id,
          workflow: 'research',
          sourceId: session!.id,
          model: CLAUDE_MODEL,
          tokensInput: promptTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: totalTokens,
          webSearches: searches,
          costUsd: cost,
        })

        // Push the final usage so the live sidebar can update without a reload.
        send({
          usage: {
            tokens_total: totalTokens,
            web_searches: searches,
            cost_usd: cost,
          },
        })
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Claude stream error:', err)
        await supabaseAdmin
          .from('research_sessions')
          .update({ status: 'failed' })
          .eq('id', session!.id)
        await logUsageEvent({
          userId: user!.id,
          workflow: 'research',
          sourceId: session!.id,
          model: CLAUDE_MODEL,
          status: 'error',
          error: err instanceof Error ? err.message : 'Generation failed',
        })
        send({ error: 'Generation failed' })
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
