import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { NO_PREAMBLE_INSTRUCTION, extractAfterMarker } from '@/lib/meeting-prep'
import type { MeetingPrepResearchSections } from '@/types'
import type { WebSearchTool20250305 } from '@anthropic-ai/sdk/resources/messages/messages'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 60

interface Params {
  params: { id: string }
}

// A single-section regenerate is far cheaper than a full research pass —
// a handful of targeted searches is plenty.
const MAX_WEB_SEARCHES = 4
const WEB_SEARCH_TOOL: WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: MAX_WEB_SEARCHES,
}
const REGENERATE_TOKEN_RESERVE = 60_000

const SECTION_LABELS: Record<keyof MeetingPrepResearchSections, string> = {
  interviewee: 'Interviewee research',
  organisation: 'Organisation research',
  motivation_profiles: 'Commercial motivation profiling',
  quotes_news: 'Recent quotes & latest news',
}

function isSectionKey(v: unknown): v is keyof MeetingPrepResearchSections {
  return v === 'interviewee' || v === 'organisation' || v === 'motivation_profiles' || v === 'quotes_news'
}

export async function POST(request: NextRequest, { params }: Params) {
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
  if (profile.role === 'user' && profile.token_limit - profile.tokens_used < REGENERATE_TOKEN_RESERVE) {
    return NextResponse.json({ error: 'Not enough token budget remaining' }, { status: 402 })
  }

  const { section, feedback } = await request.json()
  if (!isSectionKey(section)) {
    return NextResponse.json({ error: 'Invalid section' }, { status: 400 })
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
  if (session.stage !== 'awaiting_review') {
    return NextResponse.json({ error: 'This session is not at the research review stage.' }, { status: 409 })
  }

  const sections = (session.research_sections || {}) as MeetingPrepResearchSections
  const now = new Date()
  const currentYear = now.getFullYear()
  const todayStr = now.toISOString().slice(0, 10)

  const otherSections = (Object.keys(SECTION_LABELS) as (keyof MeetingPrepResearchSections)[])
    .filter((k) => k !== section)
    .map((k) => `--- ${SECTION_LABELS[k].toUpperCase()} (already accepted — do not contradict) ---\n${sections[k] || '(not yet written)'}`)
    .join('\n\n')

  const system = `You are updating ONE section of previously generated meeting-preparation research for a TRC sales representative, per the sales rep's refinement request. Apply the same source-quality, recency and editorial-orientation rules as the original research: cite sources with dates, flag unsourced claims explicitly, and never surface negative, corrosive or reputationally damaging content. TODAY'S DATE IS ${todayStr} (${currentYear}) — treat pre-training facts as possibly stale and verify with web search where useful.

Rewrite ONLY the "${SECTION_LABELS[section]}" section. Do not restate or rewrite the other sections — they are shown only for context and are already approved. The replacement text must be genuine sourced content for this section (e.g. actual quotes or news items with attribution, not your own analysis or justification of why something matters) — if the rep's feedback is vague, use your judgement on what "better" means for this section type rather than substituting commentary for content.

Your reply is not a comment or a diff — it is the ENTIRE, FINAL, ONLY text this section will contain afterward. There is no other mechanism that preserves anything: whatever you don't include is permanently deleted from this section, and whatever you do include is what the sales rep sees. If the section currently contains multiple quotes and multiple news items and the rep's feedback targets only one of them (e.g. "quote 2 is weak" or "the third news item isn't relevant"), you must still output ALL of it: copy every untouched quote and news item forward VERBATIM, character-for-character, in the same order, and change only the specific item the feedback names. "The rest is fine" means "reproduce the rest exactly as-is" — it is never permission to leave it out. Before you finish, count what the current version below contains (how many quotes, how many news items) and verify your reply contains at least that many, unless the feedback explicitly asked you to remove or consolidate items.

${NO_PREAMBLE_INSTRUCTION}`

  const userContent = `${otherSections}\n\n--- CURRENT "${SECTION_LABELS[section].toUpperCase()}" (to be replaced) ---\n${sections[section] || '(empty)'}\n\n--- SALES REP'S REFINEMENT REQUEST ---\n${(feedback || '').trim() || 'Improve this section.'}`

  const anthropic = getAnthropicClient()

  try {
    let fullText = ''
    let searchesUsed = 0
    const claudeStream = anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userContent }],
      tools: [WEB_SEARCH_TOOL],
    })

    for await (const event of claudeStream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use' && event.content_block.name === 'web_search') {
        searchesUsed += 1
      }
      // Simple concatenation across every text block, in order. Any preamble
      // Claude writes before the required <<<OUTPUT>>> marker is stripped by
      // extractAfterMarker() below regardless of which block it landed in —
      // no need to reset per-block here. (An earlier version reset fullText
      // on every new text block to drop pre-search narration, but that broke
      // longer replies: when the verbatim-preservation instruction requires
      // reproducing several existing quotes/items, Claude sometimes runs a
      // second search partway through writing them, and the reset silently
      // discarded everything written before that second search.)
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text
      }
    }

    const finalMsg = await claudeStream.finalMessage()
    const reportedSearches = (finalMsg.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests
    const usage = parseUsage(finalMsg.usage, reportedSearches ?? searchesUsed)
    const promptTokens = totalPromptTokens(usage)
    const totalTokens = promptTokens + usage.outputTokens
    const cost = calculateCost(usage)

    const replacementText = extractAfterMarker(fullText)

    // Backstop for the system prompt's verbatim-preservation instruction: if
    // the reply is drastically shorter than what it's replacing, the model
    // likely dropped untouched quotes/items instead of reproducing them. The
    // API call already happened and is billed regardless, so persist its
    // real cost before failing rather than losing it in the catch block
    // below, which logs status only, no token/cost data.
    const previousLength = (sections[section] || '').length
    if (previousLength > 200 && replacementText.length < previousLength * 0.2) {
      await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: user.id, p_tokens: totalTokens })
      await logUsageEvent({
        userId: user.id,
        workflow: 'meeting_prep_research',
        sourceId: session.id,
        model: CLAUDE_MODEL,
        tokensInput: promptTokens,
        tokensOutput: usage.outputTokens,
        tokensTotal: totalTokens,
        webSearches: usage.webSearches ?? 0,
        costUsd: cost,
        status: 'error',
        error: 'Regenerated section was suspiciously short compared to the original',
      })
      return NextResponse.json({ error: 'The regenerated section looked incomplete compared to the original. Please try again.' }, { status: 500 })
    }

    const updatedSections: MeetingPrepResearchSections = { ...sections, [section]: replacementText }

    await supabaseAdmin
      .from('meeting_prep_sessions')
      .update({
        research_sections: updatedSections,
        tokens_input: (session.tokens_input || 0) + promptTokens,
        tokens_output: (session.tokens_output || 0) + usage.outputTokens,
        tokens_total: (session.tokens_total || 0) + totalTokens,
        web_searches: (session.web_searches || 0) + (usage.webSearches ?? 0),
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
      tokensOutput: usage.outputTokens,
      tokensTotal: totalTokens,
      webSearches: usage.webSearches ?? 0,
      costUsd: cost,
    })

    return NextResponse.json({
      section,
      text: replacementText,
      usage: { tokens_total: totalTokens, web_searches: usage.webSearches ?? 0, cost_usd: cost },
    })
  } catch (err) {
    console.error('Meeting prep section regenerate error:', err)
    await logUsageEvent({
      userId: user.id,
      workflow: 'meeting_prep_research',
      sourceId: session.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Regeneration failed',
    })
    return NextResponse.json({ error: 'Failed to regenerate this section. Please try again.' }, { status: 500 })
  }
}
