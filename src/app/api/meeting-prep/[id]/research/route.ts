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

// Research covers both the interviewee and their organisation in one pass —
// give it more budget than the single-subject research module's 7.
const MAX_WEB_SEARCHES = 8
const WEB_SEARCH_TOOL: WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: MAX_WEB_SEARCHES,
}

const VALIDATION_SCHEMA = {
  type: 'object',
  properties: {
    ok: {
      type: 'boolean',
      description: 'true only if ALL six checks pass',
    },
    reasons: {
      type: 'array',
      items: { type: 'string' },
      description: 'One short sentence per FAILED check, naming what is missing or weak. Empty array if ok is true.',
    },
  },
  required: ['ok', 'reasons'],
  additionalProperties: false,
} as const

function searchPolicy() {
  const now = new Date()
  const currentYear = now.getFullYear()
  const lastYear = currentYear - 1
  const todayStr = now.toISOString().slice(0, 10)
  return `--- WEB SEARCH POLICY (MANDATORY) ---
TODAY'S DATE IS ${todayStr}. The current year is ${currentYear}. Your training data is OUT OF DATE.

RECENCY: financial/market data no older than 24 months; biographical/career information may extend to 5 years; quotes and news no older than 12 months wherever possible. Older data is only acceptable if labelled with its date.

You have a budget of ${MAX_WEB_SEARCHES} web searches — spend them well across BOTH the interviewee and the organisation. Append a recency qualifier ("${currentYear}", "latest", a month/year) to queries chasing current facts. Cite source URLs for every factual claim, with the publication date where available. If something cannot be verified, write N/A rather than falling back to training-data assumptions.`
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

      async function runResearchPass(extraInstruction?: string): Promise<string> {
        let fullText = ''
        let searchesThisPass = 0
        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 8192,
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
          tools: [WEB_SEARCH_TOOL],
        })

        for await (const event of claudeStream) {
          // Server-executed tools (web_search) stream as `server_tool_use`
          // content blocks, not `tool_use` — that's only for client-side tools.
          if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use' && event.content_block.name === 'web_search') {
            searchesThisPass += 1
            send({ status: 'web_search_start' })
          }
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text
          }
        }

        const finalMsg = await claudeStream.finalMessage()
        const reportedSearches = (finalMsg.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests
        const usage = parseUsage(finalMsg.usage, reportedSearches ?? searchesThisPass)
        promptTokens += totalPromptTokens(usage)
        outputTokens += usage.outputTokens
        webSearches += usage.webSearches ?? 0

        return fullText
      }

      async function validateResearch(sections: MeetingPrepResearchSections): Promise<{ ok: boolean; reasons: string[] }> {
        const system = `You internally validate meeting-preparation research before it is shown to a TRC sales rep. Verify all six:
1. Is there a clear "why now" for this meeting, both editorially and commercially grounded?
2. Does the research connect to the publication's editorial narrative on business and investment?
3. Are there enough substantive facts to support three genuinely distinct presentation points?
4. Is the bilateral connection to the country of publication evident?
5. Is at least one strong commercial motivation profile supported by evidence?
6. Are the recent quotes and news items strong enough to be referenced naturally in conversation?
Be strict — this gate exists to catch thin or generic research before a human reviews it.`

        const submission = `${subjectBlock(session)}

--- INTERVIEWEE RESEARCH ---
${sections.interviewee || '(missing)'}

--- ORGANISATION RESEARCH ---
${sections.organisation || '(missing)'}

--- MOTIVATION PROFILES ---
${sections.motivation_profiles || '(missing)'}

--- QUOTES & NEWS ---
${sections.quotes_news || '(missing)'}`

        try {
          const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 500,
            system,
            messages: [{ role: 'user', content: submission }],
            output_config: { format: { type: 'json_schema', schema: VALIDATION_SCHEMA } },
          })
          const usage = parseUsage(message.usage as unknown, 0)
          promptTokens += totalPromptTokens(usage)
          outputTokens += usage.outputTokens

          const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
          const parsed = JSON.parse(text) as { ok: boolean; reasons: string[] }
          return { ok: Boolean(parsed.ok), reasons: parsed.reasons || [] }
        } catch (err) {
          // Fails open — a validator outage must not block the whole stage.
          console.error('Meeting prep internal validation unavailable, accepting research as-is:', err)
          return { ok: true, reasons: [] }
        }
      }

      try {
        await supabaseAdmin
          .from('meeting_prep_sessions')
          .update({ stage: 'researching', research_prompt_snapshot: researchPromptText, error: null })
          .eq('id', session.id)
        send({ status: 'researching' })

        const firstText = await runResearchPass()
        let sections = parseResearchSections(firstText)

        send({ status: 'validating' })
        const verdict = await validateResearch(sections)

        // Internal validation loop is invisible to the user — capped at one
        // reframe retry so a stubborn miss can't loop cost indefinitely.
        if (!verdict.ok && verdict.reasons.length > 0) {
          send({ status: 'refining' })
          const retryText = await runResearchPass(
            `Your previous draft failed internal review for these reasons — deepen or reframe the research to fix them: ${verdict.reasons.join(' ')}`,
          )
          const retrySections = parseResearchSections(retryText)
          if (researchSectionsComplete(retrySections)) sections = retrySections
        }

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
            tokens_input: (session.tokens_input || 0) + promptTokens,
            tokens_output: (session.tokens_output || 0) + outputTokens,
            tokens_total: (session.tokens_total || 0) + totalTokens,
            web_searches: (session.web_searches || 0) + webSearches,
            cost_usd: Number(session.cost_usd || 0) + cost,
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
