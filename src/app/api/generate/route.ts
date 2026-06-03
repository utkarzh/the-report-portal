import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

// Cap searches per generation. Each search costs $0.01 + the result tokens
// it injects into context. 5 is a sane upper bound for an editorial research
// run — Claude self-throttles below this for most subjects.
const WEB_SEARCH_TOOL: WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5,
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

  const systemBlocks = systemPrompt
    ? [{ type: 'text' as const, text: systemPrompt, cache_control: CACHE_1H }]
    : undefined

  const SEARCH_GUIDANCE = `--- WEB SEARCH GUIDANCE ---
You have access to a web_search tool. Use it sparingly — only when freshness genuinely matters (current role, recent news in the last 12 months, very recent financial figures, ongoing events). Do not search for background information you already know with high confidence. Plan a small number of targeted queries (ideally 2–3, never more than 5) rather than many narrow ones.`

  const userContentBlocks = [
    {
      type: 'text' as const,
      text: categoryPrompt,
      cache_control: CACHE_1H,
    },
    {
      type: 'text' as const,
      text: extra
        ? `\n\n${subjectDetails}\n\n--- ADDITIONAL CONTEXT FROM USER ---\n${extra}\n\n${SEARCH_GUIDANCE}`
        : `\n\n${subjectDetails}\n\n${SEARCH_GUIDANCE}`,
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
