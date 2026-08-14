import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, MEETING_PREP_RESEARCH_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { parseResearchSections, researchSectionsComplete } from '@/lib/meeting-prep'
import type { MeetingPrepResearchSections } from '@/types'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 300

interface Params {
  params: { id: string }
}

// Per-pass search cap AND a hard total budget across ALL passes of one research
// run (first pass + any reframe). This bounds cost — without the total cap a
// run could do 8 (pass) + 8 (reframe) = 16 searches. Kept at 12 as requested.
const MAX_WEB_SEARCHES = 8
const TOTAL_SEARCH_BUDGET = 12
// Abort generation this long into the request so the persist step always runs
// before Vercel's 300s hard cap (Hobby + Fluid Compute).
const SOFT_DEADLINE_MS = 270_000

function searchPolicy() {
  const now = new Date()
  const currentYear = now.getFullYear()
  const lastYear = currentYear - 1
  const todayStr = now.toISOString().slice(0, 10)
  return `--- WEB SEARCH POLICY (MANDATORY) ---
TODAY'S DATE IS ${todayStr}. The current year is ${currentYear}. Your training data is OUT OF DATE.

RECENCY: financial/market data no older than 24 months; biographical/career information may extend to 5 years; quotes and news no older than 12 months wherever possible. Older data is only acceptable if labelled with its date.

You have a budget of up to ${MAX_WEB_SEARCHES} web searches — spend them well across BOTH the interviewee and the organisation, and stop searching once you have enough to write all four sections. Append a recency qualifier ("${currentYear}", "latest", a month/year) to queries chasing current facts. Cite source URLs for every factual claim, with the publication date where available. If something cannot be verified, write N/A rather than falling back to training-data assumptions.`
}

function subjectBlock(session: Record<string, unknown>) {
  return `--- MEETING DETAILS ---
Interviewee: ${session.interviewee_name} (${session.interviewee_title})
Interviewee Type: ${session.interviewee_type === 'company_ceo' ? 'Company CEO' : 'Government Official'}
Company / Organisation: ${session.company_org}
Country of the Company: ${session.company_country}
Publication: ${session.publication}
Country of Publication: ${session.publication_country}

--- PUBLICATION PROFILE ---
Positioning: ${session.media_positioning_snapshot || 'N/A'}
Audience & Reach: ${session.media_audience_reach_snapshot || 'N/A'}
Editorial Narrative Focus: ${session.media_narrative_snapshot || 'N/A'}

--- ADVERTISER HISTORY (already checked manually — do not re-research this) ---
${session.advertiser_history_status === 'yes'
    ? `Previously advertised with TRC: ${session.advertiser_history_details}`
    : 'No previous advertising history on record.'}`
}

export async function POST(_request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit, can_access_meeting_preparation')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_meeting_preparation) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < MEETING_PREP_RESEARCH_RESERVE
  ) {
    return NextResponse.json({ error: 'Not enough token budget remaining for research' }, { status: 402 })
  }

  const { data: session } = await supabaseAdmin
    .from('meeting_prep_sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (session.stage !== 'input' && session.stage !== 'failed') {
    return NextResponse.json({ error: 'Research already in progress or complete for this session' }, { status: 409 })
  }

  const { data: promptRow } = await supabaseAdmin
    .from('meeting_prep_prompt')
    .select('prompt_text')
    .eq('prompt_key', 'research')
    .maybeSingle()
  const researchPromptText = promptRow?.prompt_text || ''

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()
  const CACHE_1H = { type: 'ephemeral' as const, ttl: '1h' as const }

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

      let promptTokens = 0
      let outputTokens = 0
      let webSearches = 0

      // Soft deadline: abort generation with time to spare so we always reach
      // the persist step below, rather than being hard-killed at Vercel's limit
      // and leaving the session stuck at 'researching' forever.
      let aborted = false
      let activeStream: { abort: () => void } | null = null
      const deadlineTimer = setTimeout(() => {
        aborted = true
        try { activeStream?.abort() } catch {}
      }, SOFT_DEADLINE_MS)

      async function runResearchPass(extraInstruction?: string): Promise<string> {
        let fullText = ''
        let searchesThisPass = 0
        // Only allow as many searches as remain in the run's total budget.
        const perPass = Math.max(0, Math.min(MAX_WEB_SEARCHES, TOTAL_SEARCH_BUDGET - webSearches))
        const tools: WebSearchTool20250305[] = perPass > 0
          ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: perPass }]
          : []
        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 8000,
          system: [
            { type: 'text', text: searchPolicy() },
            ...(researchPromptText ? [{ type: 'text' as const, text: researchPromptText, cache_control: CACHE_1H }] : []),
          ],
          messages: [{
            role: 'user',
            content: extraInstruction
              ? `${subjectBlock(session)}\n\n--- REVISION INSTRUCTIONS ---\n${extraInstruction}`
              : subjectBlock(session),
          }],
          ...(tools.length ? { tools } : {}),
        })
        activeStream = claudeStream

        try {
          for await (const event of claudeStream) {
            // Server-executed tools (web_search) stream as `server_tool_use`.
            if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use' && event.content_block.name === 'web_search') {
              searchesThisPass += 1
              send({ status: 'web_search_start' })
            }
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              fullText += event.delta.text
            }
          }
        } catch (e) {
          if (!aborted) throw e // swallow ONLY our own soft-deadline abort
        }

        try {
          const finalMsg = await claudeStream.finalMessage()
          const reportedSearches = (finalMsg.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests
          const usage = parseUsage(finalMsg.usage, reportedSearches ?? searchesThisPass)
          promptTokens += totalPromptTokens(usage)
          outputTokens += usage.outputTokens
          webSearches += usage.webSearches ?? 0
        } catch {
          // Aborted mid-stream — usage isn't finalised; count the searches seen.
          webSearches += searchesThisPass
        }

        activeStream = null
        return fullText
      }

      try {
        await supabaseAdmin
          .from('meeting_prep_sessions')
          .update({ stage: 'researching', research_prompt_snapshot: researchPromptText, error: null })
          .eq('id', session.id)
        send({ status: 'researching' })

        // Reformat the model's own research text under the exact section
        // markers, without re-researching. A last-resort safety net for the rare
        // case where the model answers with no parseable structure at all — this
        // is a trivial restructuring task the model does reliably.
        async function repairFormat(rawText: string): Promise<string> {
          const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 8000,
            system: `You reformat existing research. Output the research below reorganised into EXACTLY these four sections, each introduced by its literal marker line on its own line, in this order and nothing else:
<<<SECTION:INTERVIEWEE>>>
<<<SECTION:ORGANISATION>>>
<<<SECTION:MOTIVATION_PROFILES>>>
<<<SECTION:QUOTES_NEWS>>>
Preserve ALL content, sources, citations and wording exactly — do NOT research, add, remove, summarise or shorten anything. Only move the existing text under the correct marker. If content for a section is scattered, gather it under the right marker.`,
            messages: [{ role: 'user', content: rawText }],
          })
          const usage = parseUsage(message.usage as unknown, 0)
          promptTokens += totalPromptTokens(usage)
          outputTokens += usage.outputTokens
          return message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
        }

        const firstText = await runResearchPass()
        let sections = parseResearchSections(firstText)

        // If the model didn't emit parseable sections, reformat its own text
        // under the markers — fast, no new research. We deliberately do NOT run a
        // second full research pass (the old validation "reframe"): that doubled
        // the runtime and overran the function time limit, leaving runs stuck.
        if (!researchSectionsComplete(sections) && !aborted) {
          send({ status: 'refining' })
          const repaired = parseResearchSections(await repairFormat(firstText))
          if (researchSectionsComplete(repaired)) sections = repaired
        }

        clearTimeout(deadlineTimer)

        const cost = calculateCost({ inputTokens: promptTokens, outputTokens, webSearches })
        const totalTokens = promptTokens + outputTokens

        // The model occasionally returns text without the <<<SECTION:…>>> markers
        // (a format miss), leaving `sections` empty/incomplete. Advancing to
        // review with nothing shows a blank screen. Instead, fail this run so the
        // user can retry — but still record the spend that actually happened.
        const researchOk = researchSectionsComplete(sections)

        await supabaseAdmin
          .from('meeting_prep_sessions')
          .update({
            // Only overwrite sections when we have a complete result.
            ...(researchOk ? { research_sections: sections } : {}),
            stage: researchOk ? 'awaiting_review' : 'failed',
            error: researchOk
              ? null
              : 'The research came back in an unexpected format (sections missing). Please run it again.',
            // Research is stage 1 — OVERWRITE the session's usage with this
            // run's figures rather than accumulating. Otherwise every retry
            // stacks on top of previous (failed) attempts and the sidebar cost
            // balloons (e.g. 46 searches / $2.55 across 4 retries). Later stages
            // (points/planteo/final) still accumulate onto this base.
            tokens_input: promptTokens,
            tokens_output: outputTokens,
            tokens_total: totalTokens,
            web_searches: webSearches,
            cost_usd: cost,
          })
          .eq('id', session.id)

        await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })

        await logUsageEvent({
          userId: user.id,
          workflow: 'meeting_prep_research',
          sourceId: session.id,
          model: CLAUDE_MODEL,
          tokensInput: promptTokens,
          tokensOutput: outputTokens,
          tokensTotal: totalTokens,
          webSearches,
          costUsd: cost,
          ...(researchOk ? {} : { status: 'error' as const, error: 'Research returned incomplete sections' }),
        })

        if (researchOk) {
          send({ done: true, sections })
        } else {
          send({ error: 'The research came back incomplete. Please run it again.' })
        }
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Meeting prep research error:', err)
        await supabaseAdmin
          .from('meeting_prep_sessions')
          .update({ stage: 'failed', error: err instanceof Error ? err.message : 'Research failed' })
          .eq('id', session.id)
        await logUsageEvent({
          userId: user.id,
          workflow: 'meeting_prep_research',
          sourceId: session.id,
          model: CLAUDE_MODEL,
          status: 'error',
          error: err instanceof Error ? err.message : 'Research failed',
        })
        send({ error: 'Research failed' })
      } finally {
        clearTimeout(deadlineTimer)
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
