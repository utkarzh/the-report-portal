import { NextRequest, NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient, isClaudeKeyRejected, CLAUDE_KEY_REJECTED_MESSAGE } from '@/lib/claude/client'
import {
  addUsage,
  calculateCost,
  parseUsage,
  totalPromptTokens,
  COMMERCIAL_PRESENTATION_WHY_NOW_RESERVE,
  type UsageBreakdown,
} from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { StreamUsageTracker } from '@/lib/claude/stream-usage'
import { sseResponse } from '@/lib/sse'
import { CLAUDE_MODEL, parseWhyNowOutput, whyNowProblems } from '@/lib/commercial-presentations'
import {
  addPresentationUsage,
  editBlockedReason,
  hasTokenBudget,
  loadPresentationBundle,
  loadWhyNowConfig,
  recordPresentationEvent,
  requirePresentationActor,
  touchPresentation,
} from '@/lib/commercial-presentations-server'
import { buildWhyNowPrompt, WhyNowSourcesMissingError } from '@/lib/commercial-presentations-why-now'

export const maxDuration = 300

interface Params {
  params: { id: string }
}

const MAX_OUTPUT_TOKENS = 2_500
// Stop the Claude work 15 s before maxDuration so saving and billing always
// get to run (Vercel kills the function at the cap, skipping both).
const SOFT_DEADLINE_MS = (maxDuration - 15) * 1000
// The corrective re-prompt is skipped when less than this is left.
const MIN_FIX_TIME_MS = 45_000

function textOf(message: Anthropic.Message): string {
  return message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

// POST — generate a Why [Country] Now version.
//   { mode: 'generate' }    — Generate / Regenerate: the new version becomes the selected one
//   { mode: 'alternative' } — Generate Alternative: added alongside, selection unchanged
//   { checkRecent: true }   — "Check for recent developments": allows web search;
//                             new external facts are listed separately for review
// Every check that needs a real status code (access, lock, budget, missing
// sources) runs BEFORE the stream starts; the stream itself carries a 10 s
// heartbeat so a long web-search run survives proxy idle timeouts.
export async function POST(request: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  const blocked = editBlockedReason(actor, bundle.presentation)
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })
  if (!hasTokenBudget(actor, COMMERCIAL_PRESENTATION_WHY_NOW_RESERVE)) {
    return NextResponse.json({ error: 'Not enough token budget remaining for another generation' }, { status: 402 })
  }

  const body = (await request.json().catch(() => ({}))) as { mode?: string; checkRecent?: boolean }
  const mode = body.mode === 'alternative' ? 'alternative' : 'generate'
  const checkRecent = body.checkRecent === true || bundle.presentation.why_now_inputs?.checkRecent === true

  const { config } = await loadWhyNowConfig(bundle.presentation.language)
  if (!config.prompt.trim()) {
    return NextResponse.json({ error: 'No Why Now prompt is configured. Ask an admin to set it up.' }, { status: 422 })
  }

  let prompt
  try {
    prompt = await buildWhyNowPrompt(bundle, config, { mode, checkRecent })
  } catch (err) {
    if (err instanceof WhyNowSourcesMissingError) return NextResponse.json({ error: err.message }, { status: 422 })
    throw err
  }

  const anthropic = getAnthropicClient()
  const presentationId = bundle.presentation.id
  const startedStatus = bundle.presentation.status
  const deadline = Date.now() + SOFT_DEADLINE_MS

  return sseResponse(
    async (send) => {
      // Usage is accumulated from what Anthropic actually charged, call by
      // call, so a run that fails or is cut short part-way still bills it.
      let usage: UsageBreakdown = parseUsage({}, 0)
      let billed = false
      const bill = async (status: 'success' | 'error', error?: string) => {
        if (billed) return { total: 0, cost: 0 }
        billed = true
        const promptTokens = totalPromptTokens(usage)
        const total = promptTokens + usage.outputTokens
        const cost = calculateCost(usage)
        if (total > 0) {
          await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: actor.id, p_tokens: total })
          await addPresentationUsage(presentationId, { tokens: total, webSearches: usage.webSearches ?? 0, cost })
        }
        await logUsageEvent({
          userId: actor.id,
          workflow: 'commercial_presentation_why_now',
          sourceId: presentationId,
          model: CLAUDE_MODEL,
          tokensInput: promptTokens,
          tokensOutput: usage.outputTokens,
          tokensTotal: total,
          webSearches: usage.webSearches ?? 0,
          costUsd: cost,
          status,
          error: error ?? null,
        })
        return { total, cost }
      }

      try {
        send({ status: checkRecent ? 'researching' : 'writing' })
        const system = [{ type: 'text' as const, text: prompt.system, cache_control: { type: 'ephemeral' as const } }]
        const userContent = [
          { type: 'text' as const, text: prompt.sourcesText, cache_control: { type: 'ephemeral' as const } },
          { type: 'text' as const, text: prompt.task },
        ]
        const tools: WebSearchTool20250305[] | undefined = checkRecent
          ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: config.maxWebSearches }]
          : undefined

        // First pass, streamed. A timer (not an in-loop check: the iterator is
        // silent during a web search) aborts it before Vercel's hard cap, so
        // the billing below always runs.
        const stream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system,
          messages: [{ role: 'user', content: userContent }],
          ...(tools ? { tools } : {}),
        })
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          try { stream.abort() } catch {}
        }, Math.max(0, deadline - Date.now()))
        const tracker = new StreamUsageTracker()
        let wroteNotice = false
        try {
          for await (const event of stream) {
            tracker.observe(event)
            if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use') {
              send({ status: 'web_search' })
            } else if (!wroteNotice && event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              wroteNotice = true
              send({ status: 'writing' })
            }
          }
        } catch (err) {
          // Bill what the broken or aborted stream consumed, then report.
          usage = await tracker.usage(anthropic, CLAUDE_MODEL)
          throw timedOut ? new Error('Why Now generation ran out of time') : err
        } finally {
          clearTimeout(timer)
        }
        usage = await tracker.usage(anthropic, CLAUDE_MODEL)
        if (!tracker.complete) throw new Error('The Why Now stream ended before the response was complete')
        const firstText = tracker.text

        let parsed = parseWhyNowOutput(firstText)
        let problems = parsed.complete ? whyNowProblems(parsed.spoken, config) : ['The response did not follow the output contract.']

        // Exactly one corrective re-prompt (no tools), mirroring the Sales
        // Coach validateReportCard retry: cheap, bounded, never a loop. Skipped
        // when too little time is left to finish it inside the request.
        const timeLeft = deadline - Date.now()
        if (problems.length > 0 && timeLeft > MIN_FIX_TIME_MS) {
          send({ status: 'revising' })
          const fix = await anthropic.messages.create(
            {
              model: CLAUDE_MODEL,
              max_tokens: MAX_OUTPUT_TOKENS,
              system,
              messages: [
                { role: 'user', content: userContent },
                { role: 'assistant', content: firstText || '(no output)' },
                {
                  role: 'user',
                  content: `Revise your answer to fix these problems, keeping the same strongest arguments and the same facts:\n- ${problems.join('\n- ')}\n\nReturn the complete answer again in exactly the output contract format.`,
                },
              ],
            },
            { timeout: timeLeft, maxRetries: 0 },
          )
          usage = addUsage(usage, parseUsage(fix.usage as unknown, 0))
          const revised = parseWhyNowOutput(textOf(fix))
          if (revised.complete) {
            // Facts came from the first pass's research; keep them if the fix dropped them.
            parsed = { ...revised, facts: revised.facts.length ? revised.facts : parsed.facts }
            problems = whyNowProblems(parsed.spoken, config)
          }
        }

        if (!parsed.complete) {
          await bill('error', 'Why Now output incomplete')
          send({ error: 'The Why Now text came back incomplete. Please try again.' })
          return
        }

        const { total, cost } = await bill('success')
        const { data: version, error: insertError } = await supabaseAdmin
          .from('presentation_why_now_versions')
          .insert({
            presentation_id: presentationId,
            kind: mode,
            spoken_text: parsed.spoken,
            new_external_facts: checkRecent ? parsed.facts : [],
            sources: { ...prompt.sources, remainingProblems: problems },
            research_used: checkRecent,
            web_searches: usage.webSearches ?? 0,
            model: CLAUDE_MODEL,
            tokens_total: total,
            cost_usd: cost,
            created_by: actor.id,
          })
          .select('*')
          .single()
        if (insertError || !version) {
          send({ error: 'The text was generated but could not be saved. Please try again.' })
          return
        }

        // Generate/Regenerate replaces the selection; an Alternative only
        // becomes selected when nothing was selected yet. Guarded on the
        // status the run started in: if the presentation was submitted or
        // approved meanwhile, the new text stays in the history unselected.
        let warnings = problems
        if (mode === 'generate' || !bundle.presentation.selected_why_now_id) {
          const { conflict } = await touchPresentation(presentationId, actor.id, { selected_why_now_id: version.id }, startedStatus)
          if (conflict) {
            warnings = [
              ...warnings,
              'The presentation’s status changed while this was being written, so the new text was saved to the version history but not selected.',
            ]
          }
        }
        await recordPresentationEvent(presentationId, mode === 'alternative' ? 'why_now_alternative' : 'why_now_generated', actor.id)
        send({ done: true, versionId: version.id, warnings })
      } catch (err) {
        console.error('Why Now generation failed:', err)
        await bill('error', err instanceof Error ? err.message : 'Why Now generation failed')
        send({ error: isClaudeKeyRejected(err) ? CLAUDE_KEY_REJECTED_MESSAGE : 'Generation failed. Please try again.' })
      }
    },
    { errorMessage: 'Generation failed. Please try again.' },
  )
}
