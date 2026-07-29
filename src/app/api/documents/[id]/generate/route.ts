import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { getDocConfig, isDocType } from '@/lib/documents'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

// Defensive cleanup: strip a trailing process-narration line the model may still
// emit despite the output contract (e.g. "Now I will build the Word document.").
// Only touches a trailing standalone sentence that clearly announces building/
// creating the document — never mid-document content.
function stripNarration(text: string): string {
  return text
    .replace(
      /\n+\s*(now\s+)?(i['’]?ll|i\s+will|let\s+me|i\s+am\s+going\s+to|i['’]?m\s+going\s+to)\s+(now\s+)?(build|create|generate|produce|prepare|assemble|put\s+together)\b[^\n]*$/i,
      '',
    )
    .trim()
}

// Long-running route: a web-searched, multi-thousand-token document (the
// Editorial Brief allows 32k output tokens + 10 searches) can take several
// minutes. Without this, Vercel's low default timeout kills the function before
// the final "persist output + status:complete" step runs, losing the result.
// 300s is the max on Vercel Pro; Hobby still caps at 60s (see notes to user).
export const maxDuration = 300

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
    .select('id, user_id, doc_type, project_country, media_partner, media_country, additional_context, prompt_snapshot, output, tokens_input, tokens_output, tokens_total, web_searches, cost_usd')
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

  // Chunked generation (Vercel Hobby has a hard 60s function cap). Each POST
  // generates ONE bounded chunk that finishes well under the limit; the browser
  // loops calls until the document is complete. `continue: true` resumes from
  // the document persisted so far (assistant-prefill continuation); otherwise
  // this is a fresh start (or regenerate) and we reset the accumulators.
  const isContinuation = (body as { continue?: boolean }).continue === true
  const accumulated = isContinuation ? (session?.output || '') : ''
  const baseTokensInput = isContinuation ? (session?.tokens_input || 0) : 0
  const baseTokensOutput = isContinuation ? (session?.tokens_output || 0) : 0
  const baseTokensTotal = isContinuation ? (session?.tokens_total || 0) : 0
  const baseSearches = isContinuation ? (session?.web_searches || 0) : 0
  const baseCost = isContinuation ? Number(session?.cost_usd || 0) : 0

  // Per-chunk caps sized to finish under Hobby's 60s ceiling. A chunk that does
  // overrun and gets killed simply isn't persisted, so the next call retries
  // from the last saved point — no lost progress.
  const ROUND_MAX_TOKENS = 2500
  const ROUND_MAX_SEARCHES = 2
  const DONE_MARKER = '<<<DOCUMENT_COMPLETE>>>'

  // Sample documents that shape the output (admin-managed, shared per type).
  const { data: samples } = await supabaseAdmin
    .from('document_samples')
    .select('filename, extracted_text')
    .eq('doc_type', session.doc_type)
    .order('created_at', { ascending: true })

  // Allow a couple of searches per chunk, but never exceed the doc's total
  // search budget across all chunks (early chunks do most of the research).
  const remainingSearches = Math.max(0, config.maxWebSearches - baseSearches)
  const roundSearchCap = Math.min(ROUND_MAX_SEARCHES, remainingSearches)
  const roundTools: WebSearchTool20250305[] =
    roundSearchCap > 0
      ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: roundSearchCap }]
      : []

  const now = new Date()
  const currentYear = now.getFullYear()
  const lastYear = currentYear - 1
  const todayStr = now.toISOString().slice(0, 10)

  const SEARCH_POLICY = `--- WEB SEARCH POLICY (MANDATORY) ---
TODAY'S DATE IS ${todayStr}. The current year is ${currentYear}. Your training data is OUT OF DATE — assume anything you "remember" may have changed.

RECENCY IS A TOP PRIORITY. Prefer ${currentYear} information; treat unverified facts older than ${lastYear} as suspect and re-verify with a fresh search. Append a recency qualifier (e.g. "${currentYear}", "latest") to queries about the current situation.

You have a budget of ${config.maxWebSearches} web searches — spend them on the highest-value facts (current figures, recent developments, ${lastYear}-${currentYear} news, regulatory/market shifts relevant to the project and media context). Cite source URLs (with publication dates where available) for every current-situation claim. If something cannot be verified, say so rather than guessing.`

  // App-level output contract. Placed LAST so it overrides any conflicting
  // instruction in the admin prompt — several admin prompts describe a
  // Claude.ai-style "write it in chat, then build a Word document" flow, which
  // makes the model narrate ("Now I will build the Word document…"). In THIS
  // app there is no separate step: the Markdown output is converted to .docx on
  // download. This block forces a single, clean document with no narration.
  const OUTPUT_CONTRACT = `--- OUTPUT FORMAT (OVERRIDES ANY CONFLICTING INSTRUCTION ABOVE) ---
You are generating ONE document as Markdown, and nothing else. This application automatically converts your Markdown into the final Word (.docx) file — you do NOT build, create, or attach a Word document yourself, and there is no separate "chat" copy to produce.

Therefore:
- Output ONLY the finished document content, in Markdown. Do not produce two versions of anything.
- Do NOT narrate your process or announce steps. Never write preamble, sign-offs, or commentary such as "Now I will build the Word document", "I will now research…", "Here is the brief", "Let me…", or similar — not before, between, or after the document.
- Begin directly with the document's first line (e.g. the cover-page title) and end with its final content line.
- Use Markdown tables for every table and Markdown links [domain.com](https://full-url) for citations.

--- LENGTH & CONTINUATION ---
The document is produced in segments. Keep writing continuously; if you run out of room in this segment you will be asked to continue, so DO NOT rush, summarise, or cut sections short to finish early — produce every section and appendix at full, specified depth.
When (and ONLY when) the ENTIRE document is complete — every section AND every appendix fully written — output the marker ${DONE_MARKER} on its very last line. Never output that marker while any part remains unwritten.`

  const systemBlocks = [
    { type: 'text' as const, text: SEARCH_POLICY },
    ...(session.prompt_snapshot
      ? [{ type: 'text' as const, text: session.prompt_snapshot, cache_control: CACHE_1H }]
      : []),
    { type: 'text' as const, text: OUTPUT_CONTRACT },
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

  // Continuation. Sonnet 4.6 does NOT support assistant-message prefill (the
  // conversation must end with a user message), so we feed the document-so-far
  // back as USER content and ask the model to continue from where it stops.
  const prior = accumulated.replace(/[\s]+$/, '')
  const continuationBlocks = prior
    ? [{
        type: 'text' as const,
        text:
          `--- DOCUMENT SO FAR (already written — do NOT repeat any of it) ---\n${prior}\n\n` +
          `--- CONTINUE ---\nOutput ONLY the next part of the document that comes immediately after the text above. ` +
          `Do not repeat it, do not restart, do not add a preamble or re-emit a heading you already wrote — just keep writing seamlessly from exactly where it stops. ` +
          `Emit ${DONE_MARKER} only once the ENTIRE document (every section and appendix) is finished.`,
      }]
    : []

  try {
    await supabaseAdmin
      .from('document_sessions')
      .update({ status: 'generating' })
      .eq('id', session!.id)

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: ROUND_MAX_TOKENS,
      system: systemBlocks,
      messages: [
        { role: 'user', content: [...userContentBlocks, ...continuationBlocks] },
      ],
      ...(roundTools.length ? { tools: roundTools } : {}),
    })

    // Text this chunk produced (skip web_search tool blocks).
    const chunkText = msg.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')

    const roundSearches =
      (msg.usage as { server_tool_use?: { web_search_requests?: number } })
        .server_tool_use?.web_search_requests ?? 0

    const usage = parseUsage(msg.usage, roundSearches)
    const promptTokens = totalPromptTokens(usage)
    const roundTokens = promptTokens + usage.outputTokens
    const roundCost = calculateCost(usage)

    // Done when the model emits the completion marker, or ends its turn on its
    // own. stop_reason 'max_tokens' means it was truncated by our per-chunk cap
    // → more to write, keep looping.
    let combined = prior + chunkText
    const hasMarker = combined.includes(DONE_MARKER)
    if (hasMarker) combined = combined.slice(0, combined.indexOf(DONE_MARKER))
    // An empty non-final chunk would loop forever — treat it as finished.
    const stalled = !hasMarker && msg.stop_reason === 'max_tokens' && chunkText.trim().length === 0
    const done = hasMarker || msg.stop_reason !== 'max_tokens' || stalled
    const cleanOutput = done ? stripNarration(combined) : combined

    const newTokensTotal = baseTokensTotal + roundTokens
    const newSearches = baseSearches + roundSearches
    const newCost = baseCost + roundCost

    await supabaseAdmin
      .from('document_sessions')
      .update({
        output: cleanOutput,
        tokens_input: baseTokensInput + promptTokens,
        tokens_output: baseTokensOutput + usage.outputTokens,
        tokens_total: newTokensTotal,
        web_searches: newSearches,
        cost_usd: newCost,
        status: done ? 'complete' : 'generating',
      })
      .eq('id', session!.id)

    await supabaseAdmin.rpc('increment_user_tokens', {
      p_user_id: user!.id,
      p_tokens: roundTokens,
    })

    await logUsageEvent({
      userId: user!.id,
      workflow: session!.doc_type,
      sourceId: session!.id,
      model: CLAUDE_MODEL,
      tokensInput: promptTokens,
      tokensOutput: usage.outputTokens,
      tokensTotal: roundTokens,
      webSearches: roundSearches,
      costUsd: roundCost,
    })

    return NextResponse.json({
      done,
      output: cleanOutput,
      usage: { tokens_total: newTokensTotal, web_searches: newSearches, cost_usd: newCost },
    })
  } catch (err) {
    console.error('Claude document chunk error:', err)
    // Keep whatever is already saved so the client can retry this chunk; only
    // hard-fail when nothing has been produced yet.
    if (!accumulated) {
      await supabaseAdmin
        .from('document_sessions')
        .update({ status: 'failed' })
        .eq('id', session!.id)
    }
    await logUsageEvent({
      userId: user!.id,
      workflow: session!.doc_type,
      sourceId: session!.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Generation failed',
    })
    return NextResponse.json({ error: 'Generation failed. Please try again.' }, { status: 500 })
  }
}
