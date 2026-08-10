import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
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

Rewrite ONLY the "${SECTION_LABELS[section]}" section. Do not restate or rewrite the other sections — they are shown only for context and are already approved. Output just the replacement text for this one section, with no marker line and no heading.`

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
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use' && event.content_block.name === 'web_search') {
        searchesUsed += 1
      }
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

    const updatedSections: MeetingPrepResearchSections = { ...sections, [section]: fullText.trim() }

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

    return NextResponse.json({ section, text: fullText.trim() })
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
