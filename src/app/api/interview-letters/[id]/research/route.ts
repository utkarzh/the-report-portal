import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, INTERVIEW_LETTER_RESEARCH_RESERVE, HAIKU_PRICING } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { parseResearchOutput, researchOutputComplete } from '@/lib/interview-letters'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
const REPAIR_MODEL = 'claude-haiku-4-5'
export const maxDuration = 120

interface Params {
  params: { id: string }
}

// Letter research is scoped to a handful of facts, not a full dossier — a
// much smaller budget than meeting-prep's 4-section research (US-051: "not a
// general company/country dossier").
const MAX_WEB_SEARCHES = 6
const SOFT_DEADLINE_MS = 100_000

function searchPolicy() {
  const now = new Date()
  const currentYear = now.getFullYear()
  const todayStr = now.toISOString().slice(0, 10)
  return `--- WEB SEARCH POLICY (MANDATORY) ---
TODAY'S DATE IS ${todayStr}. The current year is ${currentYear}. Your training data is OUT OF DATE.

You have a budget of up to ${MAX_WEB_SEARCHES} web searches. Spend them finding letter-relevant facts only — not a general company or country dossier. Append a recency qualifier ("${currentYear}", "latest") to queries chasing current facts. Cite the source as a markdown link inline in each bullet, e.g. "... [Source Name, ${currentYear}](https://...)". If something cannot be verified, omit it rather than guessing.

Search silently — do not narrate your plan before searching. Go straight to searching, then straight to the markers and content.`
}

function subjectBlock(project: Record<string, unknown>) {
  return `--- PROJECT DETAILS ---
Company: ${project.company}
Project Country: ${project.project_country}
Media Partner: ${project.media_partner}
Media Partner Country: ${project.media_partner_country || 'N/A'}
User-supplied why-now hook (if any): ${project.hook_input || '(none supplied — propose the strongest option you find)'}`
}

export async function POST(_request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit, can_access_interview_letter_generator')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_interview_letter_generator) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (
    profile.role === 'user' &&
    profile.token_limit - profile.tokens_used < INTERVIEW_LETTER_RESEARCH_RESERVE
  ) {
    return NextResponse.json({ error: 'Not enough token budget remaining for research' }, { status: 402 })
  }

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (project.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (project.stage !== 'input' && project.stage !== 'failed') {
    return NextResponse.json({ error: 'Research already in progress or complete for this project' }, { status: 409 })
  }

  // Admin-editable per company (src/app/(admin)/admin/interview-letters/research-prompt/[company]),
  // same versioned-singleton pattern as meeting_prep_prompt.
  const { data: promptRow } = await supabaseAdmin
    .from('interview_letter_research_prompts')
    .select('prompt_text')
    .eq('company', project.company)
    .maybeSingle()
  const researchPromptText = promptRow?.prompt_text || ''

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()

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
      let cost = 0

      let aborted = false
      let activeStream: { abort: () => void } | null = null
      const deadlineTimer = setTimeout(() => {
        aborted = true
        try { activeStream?.abort() } catch {}
      }, SOFT_DEADLINE_MS)

      async function repairFormat(rawText: string): Promise<string> {
        const message = await anthropic.messages.create({
          model: REPAIR_MODEL,
          max_tokens: 2000,
          system: `You reformat existing research text. Output the text below reorganised into EXACTLY these two sections, each introduced by its literal marker line on its own line, in this order and nothing else:
<<<HOOK>>>
<<<BULLETS>>>
Preserve ALL content, sources and wording exactly — do NOT research, add, remove or shorten anything. Only move the existing text under the correct marker; format bullets as lines starting with "- ".`,
          messages: [{ role: 'user', content: rawText }],
        })
        const usage = parseUsage(message.usage as unknown, 0)
        promptTokens += totalPromptTokens(usage)
        outputTokens += usage.outputTokens
        cost += calculateCost(usage, HAIKU_PRICING)
        return message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      }

      try {
        await supabaseAdmin
          .from('interview_letter_projects')
          .update({ stage: 'researching', research_prompt_snapshot: researchPromptText, error: null })
          .eq('id', project.id)
        send({ status: 'researching' })

        let fullText = ''
        let startUsage: Record<string, unknown> = {}
        let passOutputTokens = 0
        let sawFinalUsage = false
        let reportedSearches: number | undefined
        const tools: WebSearchTool20250305[] = [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }]

        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 4000,
          system: [
            { type: 'text', text: searchPolicy() },
            ...(researchPromptText ? [{ type: 'text' as const, text: researchPromptText }] : []),
          ],
          messages: [{ role: 'user', content: subjectBlock(project) }],
          tools,
        })
        activeStream = claudeStream

        try {
          for await (const event of claudeStream) {
            if (event.type === 'message_start') {
              startUsage = (event.message.usage ?? {}) as unknown as Record<string, unknown>
            } else if (
              event.type === 'content_block_start' &&
              event.content_block.type === 'server_tool_use' &&
              event.content_block.name === 'web_search'
            ) {
              send({ status: 'web_search_start' })
            } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              fullText += event.delta.text
            } else if (event.type === 'message_delta') {
              const du = event.usage as
                | { output_tokens?: number; server_tool_use?: { web_search_requests?: number } }
                | undefined
              if (typeof du?.output_tokens === 'number') {
                passOutputTokens = du.output_tokens
                sawFinalUsage = true
              }
              if (typeof du?.server_tool_use?.web_search_requests === 'number') {
                reportedSearches = du.server_tool_use.web_search_requests
              }
            }
          }
        } catch (e) {
          if (!aborted) throw e
        }

        if (!sawFinalUsage && fullText.trim()) {
          try {
            const counted = await anthropic.messages.countTokens({
              model: CLAUDE_MODEL,
              messages: [{ role: 'user', content: fullText }],
            })
            passOutputTokens = counted.input_tokens
          } catch (countErr) {
            console.error('Interview letter research output-token recount failed:', countErr)
          }
        }

        const usage = parseUsage({ ...startUsage, output_tokens: passOutputTokens }, reportedSearches ?? 0)
        promptTokens += totalPromptTokens(usage)
        outputTokens += usage.outputTokens
        webSearches += usage.webSearches ?? 0
        cost += calculateCost(usage)
        activeStream = null

        let parsed = parseResearchOutput(fullText)
        if (!researchOutputComplete(parsed) && !aborted && fullText.trim()) {
          send({ status: 'refining' })
          const repaired = parseResearchOutput(await repairFormat(fullText))
          if (researchOutputComplete(repaired)) parsed = repaired
        }

        clearTimeout(deadlineTimer)

        const totalTokens = promptTokens + outputTokens
        const ok = researchOutputComplete(parsed)

        await supabaseAdmin
          .from('interview_letter_projects')
          .update({
            ...(ok ? { research: parsed.bullets, hook_ai_suggestion: parsed.hook } : {}),
            stage: ok ? 'hook_review' : 'failed',
            error: ok ? null : 'The research came back in an unexpected format. Please try again.',
            tokens_input: promptTokens,
            tokens_output: outputTokens,
            tokens_total: totalTokens,
            web_searches: webSearches,
            cost_usd: cost,
          })
          .eq('id', project.id)

        await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })

        await logUsageEvent({
          userId: user.id,
          workflow: 'interview_letter_research',
          sourceId: project.id,
          model: CLAUDE_MODEL,
          tokensInput: promptTokens,
          tokensOutput: outputTokens,
          tokensTotal: totalTokens,
          webSearches,
          costUsd: cost,
          ...(ok ? {} : { status: 'error' as const, error: 'Research returned incomplete output' }),
        })

        if (ok) {
          send({ done: true, research: parsed.bullets, hookAiSuggestion: parsed.hook, usage: { tokens_total: totalTokens, web_searches: webSearches, cost_usd: cost } })
        } else {
          send({ error: 'The research came back incomplete. Please run it again.' })
        }
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Interview letter research error:', err)
        await supabaseAdmin
          .from('interview_letter_projects')
          .update({ stage: 'failed', error: err instanceof Error ? err.message : 'Research failed' })
          .eq('id', project.id)
        await logUsageEvent({
          userId: user.id,
          workflow: 'interview_letter_research',
          sourceId: project.id,
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
