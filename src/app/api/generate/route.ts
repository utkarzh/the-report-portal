import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

// No cap — editorial team prioritises data freshness over cost. Claude will
// search as many times as it deems necessary to verify all current facts.
// Expect 8–15 searches per generation with corresponding token usage.
const WEB_SEARCH_TOOL: WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 20,
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

  if (profile.role === 'user' && profile.tokens_used >= profile.token_limit) {
    return NextResponse.json({ error: 'Token limit reached' }, { status: 402 })
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
  // data — search aggressively, no per-request cap on number of queries.
  const SEARCH_POLICY = `--- WEB SEARCH POLICY (MANDATORY, EXHAUSTIVE) ---
Your training data is OUT OF DATE. The editorial team requires the ABSOLUTE LATEST (2025–2026) information. You MUST use the web_search tool EXTENSIVELY before writing the research. Stale data is a critical failure.

REQUIRED RESEARCH COVERAGE — search for ALL of the following before writing:
1. Current role, title, and organization (verify, do NOT assume from training data)
2. All appointments, departures, promotions, board changes in the last 18 months
3. Latest quarterly/annual financials, revenue, profit, market cap, share price moves
4. M&A activity, deals, trades, partnerships, joint ventures, funding rounds (2025–2026)
5. Recent news, press releases, announcements (last 12 months)
6. Regulatory actions, lawsuits, investigations, controversies (active and recent)
7. Product launches, strategic initiatives, market expansions (2025–2026)
8. Public statements, interviews, speeches by the subject (last 12 months)
9. Industry context — competitors' recent moves, market trends affecting the subject
10. Country-focus context — relevant political, economic, regulatory shifts in the country

SEARCH STRATEGY — be thorough, not conservative:
- Use as many searches as needed. Run separate, targeted queries for each topic above.
- After initial searches, run FOLLOW-UP searches to verify, cross-check, and fill gaps.
- If a search returns weak results, REPHRASE and search again.
- Prefer authoritative sources (Reuters, FT, Bloomberg, WSJ, official company filings, government sites) but do not exclude others if they have unique recent info.
- Do NOT stop searching until you have current, verified data for every section of the research template.

OUTPUT RULES:
- Cite source URLs for EVERY factual claim about the subject
- Every post-2024 claim MUST be backed by a web_search result, not training data
- If something cannot be verified after multiple searches, write N/A — never fall back to old training-data assumptions
- Training data is acceptable ONLY for pre-2024 historical/biographical background
- Note publication dates of cited sources where available — prefer the most recent`

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

      try {
        const claudeStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
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
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ status: 'web_search_start' })}\n\n`)
              )
            } else if (event.content_block.type === 'text' && seenToolUse) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ status: 'generating' })}\n\n`)
              )
            }
          }

          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            fullText += event.delta.text
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
            )
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

        await supabaseAdmin
          .from('research_sessions')
          .update({
            initial_output: fullText,
            tokens_input: promptTokens,
            tokens_output: usage.outputTokens,
            tokens_total: totalTokens,
            web_searches: searches,
            cost_usd: cost,
          })
          .eq('id', session!.id)

        await supabaseAdmin.rpc('increment_user_tokens', {
          p_user_id: user!.id,
          p_tokens: totalTokens,
        })

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        console.error('Claude stream error:', err)
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: 'Generation failed' })}\n\n`)
        )
      } finally {
        controller.close()
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
