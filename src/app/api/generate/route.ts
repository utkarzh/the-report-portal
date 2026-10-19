import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { CLAUDE_KEY_REJECTED_MESSAGE, getAnthropicClient, isClaudeKeyRejected } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, GENERATION_TOKEN_RESERVE, type UsageBreakdown } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { getApiUser } from '@/lib/auth/api-user'
import { geminiConfigured } from '@/lib/gemini/grounding'
import {
  RESEARCH_GEMINI_MODEL,
  emptySpend,
  enforceSourcedUrls,
  geminiResearchProblem,
  geminiWriteUpRules,
  getInterviewToolResearchProvider,
  hostOf,
  isMissingColumn,
  renderWebResearch,
  researchUrls,
  runGeminiWebResearch,
  urlsIn,
  type GeminiWebResearch,
} from '@/lib/research-engine'
import { assembleResearch, looksLikeDocument, stripLeadingNarration, type TextSegment } from '@/lib/research-narration'
import type { ResearchProvider } from '@/types'
import type { TextBlockParam, WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

// Long-running streamed generation — raise the serverless ceiling so the final
// persist runs (300s is the Vercel maximum with fluid compute).
export const maxDuration = 300

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

// The run must be saved and billed before Vercel kills the function at
// maxDuration; a killed run stays "generating" for good. A Claude stream still
// going at this point is stopped and the run marked failed (and billed).
const SOFT_DEADLINE_MS = 288_000
// Gemini planning + searching (typically ~25s) must leave Claude time to write.
const GEMINI_PHASE_MS = 120_000
// Falling back to Claude's own web search needs about this much time left.
const CLAUDE_FALLBACK_MIN_MS = 170_000

// The web research failed with no time left for the Claude fallback.
class WebResearchFailed extends Error {}

export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const body = await request.json()
  const { sessionId, additionalPrompt } = body as {
    sessionId?: string
    additionalPrompt?: string
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  // Profile, session and the engine setting are independent reads — fetching
  // them in parallel instead of one-after-the-other shaves network round trips
  // off every click of Generate.
  const [{ data: profile }, { data: session }, configuredProvider] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, role, status, tokens_used, token_limit')
      .eq('id', user.id)
      .single(),
    supabaseAdmin
      .from('research_sessions')
      .select('id, user_id, category_name, full_name, title_position, company_org, country_focus, publication, media_partner_country, general_prompt_snapshot, category_prompt_snapshot')
      .eq('id', sessionId)
      .single(),
    getInterviewToolResearchProvider(),
  ])

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

  const extra = (additionalPrompt || '').trim()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  if (session.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Admin setting (Interview Tool → Admin tools → Research engine). Without a
  // Gemini key the research runs on Claude rather than failing every interview.
  let provider: ResearchProvider = configuredProvider
  if (provider === 'gemini' && !geminiConfigured()) {
    console.warn('Interview research: GEMINI_API_KEY is not set — using Claude web search')
    provider = 'claude'
  }

  // Company documents attached to this interview — fed as supporting context.
  const { data: docRows } = await supabaseAdmin
    .from('research_documents')
    .select('filename, extracted_text')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true })
  const docsText = (docRows || [])
    .filter((d) => (d.extracted_text || '').trim())
    .map((d, i) => `### DOCUMENT ${i + 1}: ${d.filename}\n\n${d.extracted_text}`)
    .join('\n\n---\n\n')

  const systemPrompt = session.general_prompt_snapshot || ''
  const categoryPrompt = session.category_prompt_snapshot || ''
  const subjectDetails = `--- SUBJECT DETAILS ---
Full Name: ${session.full_name}
Title / Position: ${session.title_position}
Company / Organization / Ministry: ${session.company_org}
Country in Focus: ${session.country_focus}
Publication: ${session.publication}
Media Partner Country: ${session.media_partner_country}`
  const subjectText = extra
    ? `\n\n${subjectDetails}\n\n--- ADDITIONAL CONTEXT FROM USER ---\n${extra}`
    : `\n\n${subjectDetails}`

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

APPOINTMENT DATE — ONE DEDICATED SEARCH, ALWAYS (exception to the recency-qualifier rule):
- Spend one search specifically on when the subject took their CURRENT role, phrased like "<full name> appointed <organisation>" WITHOUT a year qualifier — the appointment announcement may predate ${currentYear}, and a dated query surfaces recent profiles instead of the announcement itself.
- Watch for re-appointments, second terms, interim periods and returns to a former role. If the subject held the same title before, someone else held it in between, and the CURRENT term starts at the most recent appointment, not the first. Identifying the immediate predecessor is a fast way to catch this.
- A profile or award write-up that mentions a start year in passing is NOT an appointment source; prefer the official announcement, government/company press release, or contemporaneous news coverage.

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
- A fact you mark UNCONFIRMED stays unconfirmed everywhere: never restate it elsewhere in the document as settled fact, and never derive anything from it (e.g. "approximately N years of tenure" from an unconfirmed start year)
- Training data is acceptable ONLY for clearly-labelled pre-${lastYear} historical/biographical background

FINAL OUTPUT (MANDATORY — overrides any instruction above):
- Everything you write is saved as the research document, which is downloaded and may be shared as it is. So write NOTHING except the research: no plan, progress notes or commentary before, between or after your searches ("I'll research…", "Let me search…", "I now have enough…"), and no introduction.
- Start your reply directly with the research's first heading.`

  const generalBlock: TextBlockParam[] = systemPrompt
    ? [{ type: 'text', text: systemPrompt, cache_control: CACHE_1H }]
    : []

  // Claude engine: Claude searches as it writes.
  const searchSystemBlocks: TextBlockParam[] = [{ type: 'text', text: SEARCH_POLICY }, ...generalBlock]
  // Gemini engine: Claude writes from Gemini's facts. Its rules go last so
  // they override the General Prompt's own search/verify steps.
  const writeUpSystemBlocks: TextBlockParam[] = [...generalBlock, { type: 'text', text: geminiWriteUpRules(now) }]

  const contextBlocks: TextBlockParam[] = [
    {
      type: 'text',
      text: categoryPrompt,
      cache_control: CACHE_1H,
    },
    // Supporting company documents (annual/sustainability reports, etc.),
    // cached so regenerations don't re-pay for them. Context only.
    ...(docsText
      ? [{
          type: 'text' as const,
          text:
            `--- SUPPORTING COMPANY DOCUMENTS (context only; do not copy verbatim, cite facts you use) ---\n\n${docsText}`,
          cache_control: CACHE_1H,
        }]
      : []),
  ]

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()
  const startedAt = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
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

      let aborted = false
      let activeStream: { abort: () => void } | null = null
      const deadlineTimer = setTimeout(() => {
        aborted = true
        try { activeStream?.abort() } catch {}
      }, SOFT_DEADLINE_MS)
      let heartbeat: ReturnType<typeof setInterval> | null = null

      // Gemini's spend on this run, booked as soon as its phase ends.
      const gemini = emptySpend()

      async function billGemini(error: string | null) {
        const tokens = gemini.promptTokens + gemini.outputTokens
        if (tokens > 0) {
          await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: tokens })
        }
        await logUsageEvent({
          userId: user.id,
          workflow: 'research_web_search',
          sourceId: session!.id,
          model: RESEARCH_GEMINI_MODEL,
          tokensInput: gemini.promptTokens,
          tokensOutput: gemini.outputTokens,
          tokensTotal: tokens,
          webSearches: gemini.searches,
          costUsd: gemini.costUsd,
          ...(error ? { status: 'error' as const, error } : {}),
        })
      }

      // Streams one Claude call to the client. Usage comes from finalMessage()
      // (exact, including the web-search result tokens) unless the soft
      // deadline cut the stream: then output_tokens never arrived (it comes
      // only at the end) and is recounted from the text received.
      //
      // Claude comments on its progress between searches; that commentary is
      // never shown or saved (see research-narration.ts). Text is held back
      // until the document itself starts, then streamed live. `text` is the
      // assembled document, `streamed` exactly what the client has received.
      async function streamClaude(opts: {
        system: TextBlockParam[]
        content: TextBlockParam[]
        tools?: WebSearchTool20250305[]
      }): Promise<{ text: string; streamed: string; usage: UsageBreakdown; cutShort: boolean }> {
        let raw = ''
        let segment = ''
        const segments: TextSegment[] = []
        let docStarted = false
        let streamed = ''
        const emit = (t: string) => {
          if (!t) return
          streamed += t
          send({ text: t })
        }
        let seenToolUse = false
        let webSearchCount = 0
        let startUsage: Record<string, unknown> = {}
        let cutShort = false
        // For the waiting screen: each web_search's query (its input streams
        // in as JSON) and the sites its results came from.
        const searchInputs = new Map<number, string>()
        const sendQuery = (json: string) => {
          try {
            const q = (JSON.parse(json) as { query?: unknown }).query
            if (typeof q === 'string' && q.trim()) send({ query: q.trim() })
          } catch {}
        }

        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 8192,
          system: opts.system,
          messages: [{ role: 'user', content: opts.content }],
          ...(opts.tools ? { tools: opts.tools } : {}),
        })
        activeStream = claudeStream

        try {
          for await (const event of claudeStream) {
            if (event.type === 'message_start') {
              startUsage = (event.message.usage ?? {}) as unknown as Record<string, unknown>
            } else if (event.type === 'content_block_start') {
              const block = event.content_block
              // Web search is a server tool, so its blocks are server_tool_use.
              if (block.type === 'server_tool_use' || block.type === 'tool_use') {
                seenToolUse = true
                if (block.name === 'web_search') {
                  webSearchCount += 1
                  const input = block.input as { query?: unknown } | undefined
                  if (typeof input?.query === 'string') sendQuery(JSON.stringify(input))
                  else searchInputs.set(event.index, '')
                }
                // Whatever was written since the last search ends here.
                if (segment) segments.push({ text: segment, beforeSearch: true })
                segment = ''
                send({ status: 'web_search_start', searches: webSearchCount })
              } else if (block.type === 'web_search_tool_result') {
                const hosts = Array.isArray(block.content) ? [...new Set(block.content.map((r) => hostOf(r.url)))] : []
                if (hosts.length) send({ sources: hosts })
              } else if (block.type === 'text' && seenToolUse) {
                send({ status: 'generating' })
              }
            } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
              const partial = searchInputs.get(event.index)
              if (partial !== undefined) searchInputs.set(event.index, partial + event.delta.partial_json)
            } else if (event.type === 'content_block_stop' && searchInputs.has(event.index)) {
              sendQuery(searchInputs.get(event.index)!)
              searchInputs.delete(event.index)
            } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              raw += event.delta.text
              segment += event.delta.text
              if (docStarted) {
                emit(event.delta.text)
              } else if (looksLikeDocument(segment)) {
                docStarted = true
                emit(stripLeadingNarration(segment))
              }
            }
          }
        } catch (e) {
          if (!aborted) throw e
          cutShort = true
        } finally {
          activeStream = null
        }

        if (segment) segments.push({ text: segment, beforeSearch: false })
        const text = assembleResearch(segments)

        if (!cutShort) {
          try {
            const finalMsg = await claudeStream.finalMessage()
            // Prefer the server-reported web_search count when available; fall back to the
            // count we tallied from stream events.
            const reportedSearches =
              (finalMsg.usage as { server_tool_use?: { web_search_requests?: number } })
                .server_tool_use?.web_search_requests
            return { text, streamed, usage: parseUsage(finalMsg.usage, reportedSearches ?? webSearchCount), cutShort }
          } catch (e) {
            if (!aborted) throw e
            cutShort = true
          }
        }

        let outputTokens = 0
        if (raw.trim()) {
          try {
            const counted = await anthropic.messages.countTokens({
              model: CLAUDE_MODEL,
              messages: [{ role: 'user', content: raw }],
            })
            outputTokens = counted.input_tokens
          } catch (countErr) {
            console.error('Research output-token recount failed:', countErr)
          }
        }
        return { text, streamed, usage: parseUsage({ ...startUsage, output_tokens: outputTokens }, webSearchCount), cutShort }
      }

      // research_provider needs migration 040; until it runs, save the rest.
      async function saveSession(fields: Record<string, unknown>) {
        const { error } = await supabaseAdmin.from('research_sessions').update(fields).eq('id', session!.id)
        if (!error) return
        if (isMissingColumn(error, 'research_provider')) {
          const rest = { ...fields }
          delete rest.research_provider
          const retry = await supabaseAdmin.from('research_sessions').update(rest).eq('id', session!.id)
          if (retry.error) console.error('Research session save failed:', retry.error)
        } else {
          console.error('Research session save failed:', error)
        }
      }

      try {
        // Mark as generating so a user who returns mid-run sees "Generating…".
        await supabaseAdmin
          .from('research_sessions')
          .update({ status: 'generating' })
          .eq('id', session!.id)

        let engine: ResearchProvider = provider
        send({ engine })

        let web: GeminiWebResearch | null = null
        if (provider === 'gemini') {
          send({ status: 'web_search_start' })
          // Gemini's phase sends nothing for ~25s; keep the connection warm.
          heartbeat = setInterval(() => send({ ping: true }), 10_000)
          let problem: string | null = null
          try {
            web = await runGeminiWebResearch({
              subject: {
                fullName: session!.full_name || '',
                titlePosition: session!.title_position || '',
                companyOrg: session!.company_org || '',
                countryFocus: session!.country_focus || '',
                publication: session!.publication || '',
                mediaPartnerCountry: session!.media_partner_country || '',
                categoryName: session!.category_name || '',
              },
              categoryPrompt,
              extra,
              deadline: startedAt + GEMINI_PHASE_MS,
              spent: gemini,
              // Feeds the waiting screen: the plan, then each lane's results.
              onProgress: (p) => send(p.kind === 'plan' ? { plan: p.lanes } : { lane: p }),
            })
            problem = geminiResearchProblem(web)
          } catch (e) {
            problem = e instanceof Error ? e.message : 'Gemini web research failed'
          } finally {
            clearInterval(heartbeat)
            heartbeat = null
          }
          await billGemini(problem)

          if (problem) {
            web = null
            if (SOFT_DEADLINE_MS - (Date.now() - startedAt) < CLAUDE_FALLBACK_MIN_MS) {
              throw new WebResearchFailed(`Gemini web research failed: ${problem}`)
            }
            console.warn(`Interview research ${session!.id}: Gemini web research unusable (${problem}) — falling back to Claude web search`)
            engine = 'claude'
            send({ engine })
          }
        }

        let result: { text: string; streamed: string; usage: UsageBreakdown; cutShort: boolean }
        let finalText: string
        if (web) {
          send({ status: 'generating', facts: web.factCount })
          result = await streamClaude({
            system: writeUpSystemBlocks,
            content: [...contextBlocks, { type: 'text', text: `${subjectText}\n\n${renderWebResearch(web)}` }],
          })
          const checked = enforceSourcedUrls(result.text, [...researchUrls(web), ...urlsIn(docsText), ...urlsIn(extra)])
          if (checked.removed || checked.restored) {
            console.warn(`Interview research ${session!.id}: ${checked.removed} unsourced link(s) removed, ${checked.restored} truncated link(s) restored`)
          }
          finalText = checked.text
        } else {
          result = await streamClaude({
            system: searchSystemBlocks,
            content: [...contextBlocks, { type: 'text', text: subjectText }],
            tools: [WEB_SEARCH_TOOL],
          })
          finalText = result.text
        }

        const usage = result.usage
        const promptTokens = totalPromptTokens(usage)
        const totalTokens = promptTokens + usage.outputTokens
        const cost = calculateCost(usage)
        const searches = usage.webSearches ?? 0

        if (result.cutShort) {
          // Cut off at the soft deadline: no partial save (US-018), but the
          // spend is real, so bill it.
          await saveSession({ status: 'failed' })
          if (totalTokens > 0) {
            await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
          }
          await logUsageEvent({
            userId: user.id,
            workflow: 'research',
            sourceId: session!.id,
            model: CLAUDE_MODEL,
            tokensInput: promptTokens,
            tokensOutput: usage.outputTokens,
            tokensTotal: totalTokens,
            webSearches: searches,
            costUsd: cost,
            status: 'error',
            error: 'Stopped at the time limit before the research was finished',
          })
          send({ error: 'The research took too long and was stopped. Please try again.' })
          return
        }

        // The session row carries this run's whole research spend (Gemini's
        // searching + Claude's writing); the ledger keeps them as two rows.
        const sessionTokens = totalTokens + gemini.promptTokens + gemini.outputTokens
        const sessionCost = cost + gemini.costUsd
        const sessionSearches = searches + gemini.searches

        // Persist FIRST — this is the part that must never be skipped, even if
        // the client is gone. The SSE events below are best-effort.
        await saveSession({
          initial_output: finalText,
          tokens_input: promptTokens + gemini.promptTokens,
          tokens_output: usage.outputTokens + gemini.outputTokens,
          tokens_total: sessionTokens,
          web_searches: sessionSearches,
          cost_usd: sessionCost,
          status: 'complete',
          research_provider: engine,
        })

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

        // Swap in the saved version wherever it differs from what streamed:
        // a remark dropped mid-document, or a link the citation check removed.
        if (finalText.trim() !== result.streamed.trim()) send({ final: finalText })

        // Push the final usage so the live sidebar can update without a reload.
        send({
          usage: {
            tokens_total: sessionTokens,
            web_searches: sessionSearches,
            cost_usd: sessionCost,
          },
          engine,
        })
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Research generation error:', err)
        await supabaseAdmin
          .from('research_sessions')
          .update({ status: 'failed' })
          .eq('id', session!.id)
        // A Gemini failure is already on the ledger, and Claude never ran.
        if (!(err instanceof WebResearchFailed)) {
          await logUsageEvent({
            userId: user!.id,
            workflow: 'research',
            sourceId: session!.id,
            model: CLAUDE_MODEL,
            status: 'error',
            error: err instanceof Error ? err.message : 'Generation failed',
          })
        }
        send({
          error: err instanceof WebResearchFailed
            ? 'The web research did not complete. Please try again.'
            : isClaudeKeyRejected(err)
            ? CLAUDE_KEY_REJECTED_MESSAGE
            : 'Generation failed',
        })
      } finally {
        clearTimeout(deadlineTimer)
        if (heartbeat) clearInterval(heartbeat)
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
