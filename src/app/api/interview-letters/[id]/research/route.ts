import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens, INTERVIEW_LETTER_RESEARCH_RESERVE, HAIKU_PRICING } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { briefExcerpt, parseResearchOutput, researchOutputComplete } from '@/lib/interview-letters'
import {
  BRIEF_CHARS_FOR_CLAUDE,
  BRIEF_CHARS_FOR_GEMINI,
  GEMINI_RESEARCH_MODEL,
  GeminiResearchError,
  buildCheckPrompt,
  buildClaudeResearchUserContent,
  buildResearchSystem,
  buildSynthesisUserContent,
  geminiConfigured,
  getResearchProvider,
  linkFactTags,
  runGeminiResearch,
  type SourceLink,
} from '@/lib/interview-letter-research'
import type { InterviewLetterResearchProvider } from '@/types'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
const REPAIR_MODEL = 'claude-haiku-4-5'
export const maxDuration = 180

interface Params {
  params: { id: string }
}

// Letter research is scoped to a handful of facts, not a full dossier — a
// much smaller budget than meeting-prep's 4-section research (US-051: "not a
// general company/country dossier").
const MAX_WEB_SEARCHES = 6
// Everything (research, a possible reformat pass, saving and billing) must
// finish inside maxDuration, so the research itself stops here.
const SOFT_DEADLINE_MS = 150_000

// "Run research again" from a later step (step navigation, 19 Oct 2026).
// Only research is replaced; the letter and email stay, so the user can keep
// them from the hook screen.
const RERUN_STAGES = ['hook_review', 'letter_review', 'letter_approved', 'email_review', 'complete']

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

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
  const body = await request.json().catch(() => ({}))
  const rerun = Boolean((body as { rerun?: boolean }).rerun) && RERUN_STAGES.includes(project.stage)
  if (project.stage !== 'input' && project.stage !== 'failed' && !rerun) {
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

  // Admin setting (/admin/interview-letters). Without a Gemini key the
  // research falls back to Claude rather than failing every project.
  let provider: InterviewLetterResearchProvider = await getResearchProvider()
  if (provider === 'gemini' && !geminiConfigured()) {
    console.warn('Interview letter research: GEMINI_API_KEY is not set — falling back to Claude')
    provider = 'claude'
  }

  const briefText: string = project.editorial_brief_snapshot || ''
  const brief = briefText
    ? {
        title: project.editorial_brief_title || 'Editorial Brief',
        text: briefExcerpt(briefText, provider === 'gemini' ? BRIEF_CHARS_FOR_GEMINI : BRIEF_CHARS_FOR_CLAUDE),
      }
    : null
  // Claude: one call that searches as it goes. Gemini: a grounded CHECK, then
  // a SYNTHESIS against the brief (see interview-letter-research.ts for why).
  const systemBlocks = buildResearchSystem(researchPromptText, project, { provider, hasBrief: Boolean(brief) })
  const claudeUserContent = provider === 'claude' ? buildClaudeResearchUserContent(project, brief) : ''
  const checkPrompt = provider === 'gemini' ? buildCheckPrompt(project, brief) : null
  const promptSnapshot = checkPrompt
    ? `${systemBlocks.join('\n\n')}\n\n=== GEMINI RESEARCH CHECK ===\n${checkPrompt.system}\n\n${checkPrompt.user}`
    : systemBlocks.join('\n\n')
  const researchModel = provider === 'gemini' ? GEMINI_RESEARCH_MODEL : CLAUDE_MODEL

  // A first run sets the project's totals; a re-run adds to what the letter
  // and email already spent. A failed re-run returns the project to the step
  // it was on (the research it replaced is only overwritten on success).
  const failStage = rerun ? project.stage : 'failed'
  const prior = rerun
    ? {
        input: project.tokens_input || 0,
        output: project.tokens_output || 0,
        total: project.tokens_total || 0,
        searches: project.web_searches || 0,
        cost: Number(project.cost_usd || 0),
      }
    : { input: 0, output: 0, total: 0, searches: 0, cost: 0 }
  const totals = (p: number, o: number, w: number, c: number) => ({
    tokens_input: prior.input + p,
    tokens_output: prior.output + o,
    tokens_total: prior.total + p + o,
    web_searches: prior.searches + w,
    cost_usd: prior.cost + c,
  })

  const anthropic = getAnthropicClient()
  const encoder = new TextEncoder()
  const startedAt = Date.now()

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
          max_tokens: 3000,
          system: `You reformat existing research text. Output the text below reorganised into these sections, each introduced by its literal marker line on its own line, in this order and nothing else:
<<<HOOK>>>
<<<BULLETS>>>
<<<UPDATES>>>
<<<CAUTIONS>>>
HOOK is the single recommended why-now hook paragraph. BULLETS are the verified facts. UPDATES are changes or new developments compared with an Editorial Brief (omit the section if the text has none). CAUTIONS are unverified, conflicting or forecast items (omit the section if the text has none).
Preserve ALL content, sources, links and wording exactly — do NOT research, add, remove or shorten anything. Only move the existing text under the correct marker; format list items as lines starting with "- ".`,
          messages: [{ role: 'user', content: rawText }],
        })
        const usage = parseUsage(message.usage as unknown, 0)
        promptTokens += totalPromptTokens(usage)
        outputTokens += usage.outputTokens
        cost += calculateCost(usage, HAIKU_PRICING)
        return message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      }

      async function runClaude(): Promise<string> {
        let fullText = ''
        let startUsage: Record<string, unknown> = {}
        let passOutputTokens = 0
        let sawFinalUsage = false
        let reportedSearches: number | undefined
        const tools: WebSearchTool20250305[] = [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }]

        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 5000,
          system: systemBlocks.map((text) => ({ type: 'text' as const, text })),
          messages: [{ role: 'user', content: claudeUserContent }],
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
        return fullText
      }

      async function bill(ok: boolean, errorMessage?: string) {
        const totalTokens = promptTokens + outputTokens
        if (totalTokens > 0) {
          await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
        }
        await logUsageEvent({
          userId: user.id,
          workflow: 'interview_letter_research',
          sourceId: project.id,
          model: researchModel,
          tokensInput: promptTokens,
          tokensOutput: outputTokens,
          tokensTotal: totalTokens,
          webSearches,
          costUsd: cost,
          ...(ok ? {} : { status: 'error' as const, error: errorMessage || 'Research failed' }),
        })
        return totalTokens
      }

      try {
        await supabaseAdmin
          .from('interview_letter_projects')
          .update({
            stage: 'researching',
            research_prompt_snapshot: promptSnapshot,
            research_provider: provider,
            error: null,
          })
          .eq('id', project.id)
        send({ status: 'researching', provider })

        let fullText = ''
        let factLinks: Map<string, SourceLink[]> | null = null
        if (checkPrompt) {
          try {
            const outcome = await runGeminiResearch({
              check: checkPrompt,
              synthesis: { system: systemBlocks.join('\n\n'), user: (facts) => buildSynthesisUserContent(project, brief, facts) },
              deadline: startedAt + SOFT_DEADLINE_MS,
              onStep: (step) => send({ status: step === 'searching' ? 'web_search_start' : 'synthesising' }),
            })
            promptTokens += outcome.promptTokens
            outputTokens += outcome.outputTokens
            webSearches += outcome.searches
            cost += outcome.costUsd
            fullText = outcome.text
            factLinks = outcome.factLinks
          } catch (e) {
            if (e instanceof GeminiResearchError) {
              promptTokens += e.spent.promptTokens
              outputTokens += e.spent.outputTokens
              webSearches += e.spent.searches
              cost += e.spent.costUsd
            }
            throw e
          }
        } else {
          fullText = await runClaude()
        }

        let parsed = parseResearchOutput(fullText)
        if (!researchOutputComplete(parsed) && !aborted && fullText.trim()) {
          send({ status: 'refining' })
          const repaired = parseResearchOutput(await repairFormat(fullText))
          if (researchOutputComplete(repaired)) parsed = repaired
        }

        clearTimeout(deadlineTimer)
        const ok = researchOutputComplete(parsed)

        // Gemini cites its verified facts as [F#]; swap those for the real
        // source links. The hook is letter-ready prose, so its tags just go.
        if (ok && factLinks) {
          const links = factLinks
          const link = (lines: string[]) => lines.map((l) => linkFactTags(l, links))
          parsed = {
            hook: linkFactTags(parsed.hook, new Map()),
            bullets: link(parsed.bullets),
            updates: link(parsed.updates),
            cautions: link(parsed.cautions),
          }
        }

        const totalTokens = promptTokens + outputTokens
        await supabaseAdmin
          .from('interview_letter_projects')
          .update({
            ...(ok
              ? {
                  research: parsed.bullets,
                  research_updates: parsed.updates,
                  research_cautions: parsed.cautions,
                  hook_ai_suggestion: parsed.hook,
                }
              : {}),
            stage: ok ? 'hook_review' : failStage,
            error: ok ? null : 'The research came back in an unexpected format. Please try again.',
            ...totals(promptTokens, outputTokens, webSearches, cost),
          })
          .eq('id', project.id)

        await bill(ok, 'Research returned incomplete output')

        if (ok) {
          send({
            done: true,
            research: parsed.bullets,
            researchUpdates: parsed.updates,
            researchCautions: parsed.cautions,
            hookAiSuggestion: parsed.hook,
            provider,
            usage: { tokens_total: totalTokens, web_searches: webSearches, cost_usd: cost },
          })
        } else {
          send({ error: 'The research came back incomplete. Please run it again.' })
        }
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Interview letter research error:', err)
        const message = err instanceof Error ? err.message : 'Research failed'
        await supabaseAdmin
          .from('interview_letter_projects')
          .update({
            stage: failStage,
            error: message,
            ...totals(promptTokens, outputTokens, webSearches, cost),
          })
          .eq('id', project.id)
        await bill(false, message)
        send({ error: err instanceof GeminiResearchError ? message : 'Research failed' })
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
