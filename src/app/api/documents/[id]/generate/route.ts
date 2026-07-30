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
// With fluid compute (default on new projects) 300s is both the default and the
// maximum on Hobby, and the default on Pro — the old 60s Hobby cap is gone.
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

  // Segmented continuation. Each POST writes ONE pass, bounded by the soft
  // deadline below or by the model's own max_tokens — neither of which means the
  // document is finished. The client chains passes automatically until the
  // completion marker lands (see DocumentOutput's runToCompletion), and falls
  // back to a manual Continue button at its round cap.
  // `continue: true` resumes from the document persisted so far; otherwise this
  // is a fresh start (or regenerate) and we reset the accumulators.
  const isContinuation = (body as { continue?: boolean }).continue === true
  const accumulated = isContinuation ? (session?.output || '') : ''
  const baseTokensInput = isContinuation ? (session?.tokens_input || 0) : 0
  const baseTokensOutput = isContinuation ? (session?.tokens_output || 0) : 0
  const baseTokensTotal = isContinuation ? (session?.tokens_total || 0) : 0
  const baseSearches = isContinuation ? (session?.web_searches || 0) : 0
  const baseCost = isContinuation ? Number(session?.cost_usd || 0) : 0

  const DONE_MARKER = '<<<DOCUMENT_COMPLETE>>>'

  // We STREAM the generation and let the model write as much as it can, rather
  // than capping each pass to a small fixed token count. Two things make that
  // safe under a serverless timeout:
  //   1. A soft deadline (below the platform's hard cap) after which we stop
  //      reading the stream and return cleanly, marking the doc incomplete so
  //      the user gets a "Continue" button.
  //   2. Incremental persistence — we save the text-so-far every few seconds,
  //      so even if the platform HARD-kills the function before the soft
  //      deadline, no more than a couple of seconds of writing is lost and
  //      Continue resumes from the last save.
  // Use (almost) the whole function window: stop a short margin BEFORE the
  // platform's hard cap so we exit cleanly — billing, analytics logging and
  // marker cleanup all run — instead of being abruptly killed (which Vercel
  // gives no hook to catch, and which would skip token accounting). A hard-kill
  // is still survived by the incremental saves + client recovery; this just
  // avoids relying on it. `maxDuration` (300, on Hobby and Pro alike) is the
  // real ceiling; the
  // 15s margin covers the last DB writes + response flush. Override the whole
  // thing with DOC_GEN_SOFT_DEADLINE_MS if your plan's real cap differs.
  const HARD_CAP_MARGIN_MS = 15_000
  const SOFT_DEADLINE_MS =
    Number(process.env.DOC_GEN_SOFT_DEADLINE_MS) || maxDuration * 1_000 - HARD_CAP_MARGIN_MS
  const SAVE_INTERVAL_MS = 2_500

  // Sample documents that shape the output (admin-managed, shared per type).
  const { data: samples } = await supabaseAdmin
    .from('document_samples')
    .select('filename, extracted_text')
    .eq('doc_type', session.doc_type)
    .order('created_at', { ascending: true })

  // Give each pass the doc's remaining search budget (early passes do most of
  // the research; later ones rarely search).
  const remainingSearches = Math.max(0, config.maxWebSearches - baseSearches)
  const roundTools: WebSearchTool20250305[] =
    remainingSearches > 0
      ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: remainingSearches }]
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
  //
  // COST: the document-so-far is re-sent on every Continue, and it grows each
  // round — billed naively that's quadratic input cost (round N re-reads
  // rounds 1..N-1). We put it in its OWN block with a 1h cache breakpoint, and
  // everything before it (samples, task) is byte-identical across rounds, so
  // the next round's prefix matches this cached content: only the newly-written
  // tail is charged as fresh input. That turns the re-send cost from quadratic
  // to ~linear. The CONTINUE instruction goes in a SEPARATE trailing block so
  // it never sits between the growing document and the cache breakpoint (which
  // would break the prefix match).
  const prior = accumulated.replace(/[\s]+$/, '')
  const continuationBlocks = prior
    ? [
        {
          type: 'text' as const,
          text: `--- DOCUMENT SO FAR (already written — do NOT repeat any of it) ---\n${prior}`,
          cache_control: CACHE_1H,
        },
        {
          type: 'text' as const,
          text:
            `--- CONTINUE ---\nOutput ONLY the next part of the document that comes immediately after the text above. ` +
            `Do not repeat it, do not restart, do not add a preamble or re-emit a heading you already wrote — just keep writing seamlessly from exactly where it stops. ` +
            `Emit ${DONE_MARKER} only once the ENTIRE document (every section and appendix) is finished.`,
        },
      ]
    : []

  const encoder = new TextEncoder()

  // We stream so the client sees live typing AND so we can persist incrementally
  // and stop at the soft deadline. The generation must finish + persist even if
  // the client disconnects mid-stream, so enqueue() failures never abort the run.
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

      // This pass's newly-written text (streamed on top of `prior`).
      let fullText = ''

      try {
        await supabaseAdmin
          .from('document_sessions')
          .update({ status: 'generating' })
          .eq('id', session!.id)

        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: config.maxTokens,
          system: systemBlocks,
          messages: [
            { role: 'user', content: [...userContentBlocks, ...continuationBlocks] },
          ],
          ...(roundTools.length ? { tools: roundTools } : {}),
        })

        // Usage is tracked from stream events (not finalMessage) so it's valid
        // even when we abort at the soft deadline.
        let startUsage: Record<string, unknown> = {}
        let outputTokens = 0
        // `message_delta` is the ONLY event carrying the API's output-token
        // count, and it arrives once at the end of a message. A pass we cut
        // short never sees it — so we must not report its 0 as the real count.
        let sawFinalUsage = false
        let reportedSearches: number | undefined
        let webSearchCount = 0
        let stopReason: string | null = null
        let softDeadlineHit = false
        const startTime = Date.now()
        let lastSave = startTime

        // Wall-clock deadline. This MUST be a timer rather than a check inside
        // the loop body: the loop only advances when an event arrives, and the
        // SDK's iterator yields no keepalive (RawMessageStreamEvent has no
        // `ping`), so during a quiet stretch — a server-side web search
        // round-trip — an in-loop check simply cannot run and the function sails
        // past the platform's hard cap. abort() rejects the pending await, so an
        // idle gap is interrupted instead of waited out, and the persist +
        // billing + logging below still get to run.
        const deadlineTimer = setTimeout(() => {
          softDeadlineHit = true
          try { claudeStream.abort() } catch {}
        }, SOFT_DEADLINE_MS)

        try {
        for await (const event of claudeStream) {
          if (event.type === 'message_start') {
            startUsage = (event.message.usage ?? {}) as unknown as Record<string, unknown>
          } else if (
            event.type === 'content_block_start' &&
            event.content_block.type === 'tool_use'
          ) {
            if (event.content_block.name === 'web_search') webSearchCount += 1
            send({ status: 'web_search_start' })
          } else if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            fullText += event.delta.text
            send({ text: event.delta.text })
            // Incremental persistence — bounds worst-case data loss to
            // SAVE_INTERVAL_MS if the platform hard-kills us before we return.
            if (Date.now() - lastSave > SAVE_INTERVAL_MS) {
              lastSave = Date.now()
              await supabaseAdmin
                .from('document_sessions')
                .update({ output: prior + fullText, status: 'generating' })
                .eq('id', session!.id)
            }
          } else if (event.type === 'message_delta') {
            const du = event.usage as
              | { output_tokens?: number; server_tool_use?: { web_search_requests?: number } }
              | undefined
            if (typeof du?.output_tokens === 'number') {
              outputTokens = du.output_tokens
              sawFinalUsage = true
            }
            if (typeof du?.server_tool_use?.web_search_requests === 'number') {
              reportedSearches = du.server_tool_use.web_search_requests
            }
            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason
          }
        }
        } catch (streamErr) {
          // Our own deadline abort is expected and lands here — everything the
          // stream produced is still in `fullText`, so fall through and account
          // for it. Any other failure is a real error.
          if (!softDeadlineHit) throw streamErr
        } finally {
          clearTimeout(deadlineTimer)
        }
        try { claudeStream.abort() } catch {}

        // Recover the output-token count when the pass was cut short. Without
        // this, `outputTokens` stays 0 and the pass is billed as if Claude wrote
        // nothing — output is the expensive side, so the ledger under-counts by
        // most of the real cost. countTokens is free and uses the same
        // tokenizer, so counting the text we actually received is exact.
        if (!sawFinalUsage && fullText.trim()) {
          try {
            const counted = await anthropic.messages.countTokens({
              model: CLAUDE_MODEL,
              messages: [{ role: 'user', content: fullText }],
            })
            outputTokens = counted.input_tokens
          } catch (countErr) {
            console.error('Output-token recount failed; pass will under-report:', countErr)
          }
        }

        // Surfaces which constraint actually ended this pass (our clock vs
        // Claude's own output budget) — otherwise both look identical from the
        // outside, since both hand back a "Continue".
        console.log(
          `[doc-gen] session=${session!.id} elapsed=${Math.round((Date.now() - startTime) / 1000)}s ` +
            `stop_reason=${stopReason} soft_deadline=${softDeadlineHit} ` +
            `output_tokens=${outputTokens}${sawFinalUsage ? '' : ' (recounted)'}`,
        )

        const roundSearches = reportedSearches ?? webSearchCount
        const usage = parseUsage({ ...startUsage, output_tokens: outputTokens }, roundSearches)
        const promptTokens = totalPromptTokens(usage)
        const roundTokens = promptTokens + usage.outputTokens
        const roundCost = calculateCost(usage)

        // Done when the model emits the completion marker or ends its own turn.
        // A soft-deadline cut, or the model stopping on 'max_tokens' (its output
        // budget), means there's more to write → not done, the user can Continue.
        let combined = prior + fullText
        const hasMarker = combined.includes(DONE_MARKER)
        if (hasMarker) combined = combined.slice(0, combined.indexOf(DONE_MARKER))
        // A pass that produced no new text and wasn't cut off can't progress —
        // treat it as finished to avoid an endless Continue.
        const stalled = !softDeadlineHit && !hasMarker && fullText.trim().length === 0
        const done = !softDeadlineHit && (hasMarker || stopReason !== 'max_tokens' || stalled)
        const cleanOutput = done ? stripNarration(combined) : combined

        const newTokensTotal = baseTokensTotal + roundTokens
        const newSearches = baseSearches + roundSearches
        const newCost = baseCost + roundCost

        // Persist FIRST — must never be skipped even if the client is gone.
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

        send({
          done,
          output: cleanOutput,
          usage: { tokens_total: newTokensTotal, web_searches: newSearches, cost_usd: newCost },
        })
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Claude document stream error:', err)
        // Keep whatever streamed so far so Continue can resume; only hard-fail
        // when this pass produced nothing AND there was no prior content.
        const partial = prior + fullText
        if (partial.trim()) {
          await supabaseAdmin
            .from('document_sessions')
            .update({ output: partial, status: 'generating' })
            .eq('id', session!.id)
        } else if (!accumulated) {
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
        send({ error: 'Generation failed. Please try again.' })
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
