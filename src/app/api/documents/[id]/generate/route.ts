import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { getDocConfig, isDocType } from '@/lib/documents'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

// Same 1h cache TTL used by /api/generate — keeps the (shared, stable) prompt +
// sample docs hot across generations of the same type.
const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
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

  const { data: session } = await supabaseAdmin
    .from('document_sessions')
    .select('id, user_id, doc_type, project_country, media_partner, media_country, additional_context, prompt_snapshot')
    .eq('id', params.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!isDocType(session.doc_type)) {
    return NextResponse.json({ error: 'Invalid document type' }, { status: 400 })
  }
  const config = getDocConfig(session.doc_type)

  // Headroom gate — same as create, re-checked at generation time.
  if (
    profile.role === 'user' &&
    profile.token_limit != null &&
    profile.token_limit - profile.tokens_used < config.tokenReserve
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining for another generation' },
      { status: 402 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const extra = ((body as { additionalPrompt?: string }).additionalPrompt || '').trim()

  // Sample documents that shape the output (admin-managed, shared per type).
  const { data: samples } = await supabaseAdmin
    .from('document_samples')
    .select('filename, extracted_text')
    .eq('doc_type', session.doc_type)
    .order('created_at', { ascending: true })

  const WEB_SEARCH_TOOL: WebSearchTool20250305 = {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: config.maxWebSearches,
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const lastYear = currentYear - 1
  const todayStr = now.toISOString().slice(0, 10)

  const SEARCH_POLICY = `--- WEB SEARCH POLICY (MANDATORY) ---
TODAY'S DATE IS ${todayStr}. The current year is ${currentYear}. Your training data is OUT OF DATE — assume anything you "remember" may have changed.

RECENCY IS A TOP PRIORITY. Prefer ${currentYear} information; treat unverified facts older than ${lastYear} as suspect and re-verify with a fresh search. Append a recency qualifier (e.g. "${currentYear}", "latest") to queries about the current situation.

You have a budget of ${config.maxWebSearches} web searches — spend them on the highest-value facts (current figures, recent developments, ${lastYear}-${currentYear} news, regulatory/market shifts relevant to the project and media context). Cite source URLs (with publication dates where available) for every current-situation claim. If something cannot be verified, say so rather than guessing.`

  const systemBlocks = [
    { type: 'text' as const, text: SEARCH_POLICY },
    ...(session.prompt_snapshot
      ? [{ type: 'text' as const, text: session.prompt_snapshot, cache_control: CACHE_1H }]
      : []),
  ]

  const sampleText = (samples || [])
    .filter((s) => (s.extracted_text || '').trim())
    .map((s, i) => `### SAMPLE ${i + 1}: ${s.filename}\n\n${s.extracted_text}`)
    .join('\n\n---\n\n')

  const inputs = [
    session.project_country ? `Project Country: ${session.project_country}` : null,
    session.media_partner ? `Media Partner: ${session.media_partner}` : null,
    session.media_country ? `Media Country: ${session.media_country}` : null,
  ].filter(Boolean).join('\n')

  const taskBlock = `--- TASK ---
Produce a ${config.label}. ${config.lengthGuidance}

--- INPUTS ---
${inputs || '(no structured inputs provided)'}${
    session.additional_context ? `\n\n--- ADDITIONAL CONTEXT FROM USER ---\n${session.additional_context}` : ''
  }${extra ? `\n\n--- REVISION REQUEST (regenerate with this feedback) ---\n${extra}` : ''}`

  const userContentBlocks = [
    ...(sampleText
      ? [{
          type: 'text' as const,
          text: `--- SAMPLE ${config.label.toUpperCase()} DOCUMENTS (match their structure, depth, and tone) ---\n\n${sampleText}`,
          cache_control: CACHE_1H,
        }]
      : []),
    { type: 'text' as const, text: taskBlock },
  ]

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ''
      let seenToolUse = false
      let webSearchCount = 0
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
        await supabaseAdmin
          .from('document_sessions')
          .update({ status: 'generating' })
          .eq('id', session!.id)

        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: config.maxTokens,
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
        const reportedSearches =
          (finalMsg.usage as { server_tool_use?: { web_search_requests?: number } })
            .server_tool_use?.web_search_requests
        const searches = reportedSearches ?? webSearchCount

        const usage = parseUsage(finalMsg.usage, searches)
        const promptTokens = totalPromptTokens(usage)
        const totalTokens = promptTokens + usage.outputTokens
        const cost = calculateCost(usage)

        // Persist FIRST — must never be skipped even if the client is gone.
        await supabaseAdmin
          .from('document_sessions')
          .update({
            output: fullText,
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

        await logUsageEvent({
          userId: user!.id,
          workflow: session!.doc_type,
          sourceId: session!.id,
          model: CLAUDE_MODEL,
          tokensInput: promptTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: totalTokens,
          webSearches: searches,
          costUsd: cost,
        })

        send({
          usage: {
            tokens_total: totalTokens,
            web_searches: searches,
            cost_usd: cost,
          },
        })
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Claude document stream error:', err)
        await supabaseAdmin
          .from('document_sessions')
          .update({ status: 'failed' })
          .eq('id', session!.id)
        await logUsageEvent({
          userId: user!.id,
          workflow: session!.doc_type,
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
