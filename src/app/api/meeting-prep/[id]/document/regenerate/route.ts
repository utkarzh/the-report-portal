import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { MEETING_PREP_DOC_BLOCK_RESERVE } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { researchSectionsToPrompt, advertiserHistoryToPrompt, NO_PREAMBLE_INSTRUCTION, extractAfterMarker } from '@/lib/meeting-prep'
import {
  FINAL_BLOCKS, finalBlockTitle, isFinalBlockKey, meetingTypeNoteForDocument,
} from '@/lib/meeting-prep-document'
import {
  addSessionUsage, currentFinalSections, loadOwnedSession, requireMeetingPrepCaller, saveFinalSections, streamWithDeadline,
} from '@/lib/meeting-prep-server'
import type { MeetingPrepResearchSections } from '@/types'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const maxDuration = 180
const SOFT_DEADLINE_MS = 160_000
const MAX_WEB_SEARCHES = 3

interface Params {
  params: { id: string }
}

// POST /api/meeting-prep/[id]/document/regenerate  { block, feedback }
// Rewrites ONE of the document's first four blocks, keeping the other three
// as they are (client request: "for each block you put regenerate, edit").
// Uses the admin's final-document prompt so the same rules apply as when the
// document was first written, and may search the web when the rep's request
// needs information the research doesn't have (e.g. a more recent quote).
export async function POST(request: NextRequest, { params }: Params) {
  const caller = await requireMeetingPrepCaller(MEETING_PREP_DOC_BLOCK_RESERVE)
  if ('response' in caller) return caller.response
  const loaded = await loadOwnedSession(params.id, caller)
  if ('response' in loaded) return loaded.response
  const session = loaded.session

  const body = await request.json().catch(() => ({}))
  const { block, feedback } = body as { block?: string; feedback?: string }
  if (!isFinalBlockKey(block)) return NextResponse.json({ error: 'Invalid block' }, { status: 400 })
  if (session.stage !== 'complete') {
    return NextResponse.json({ error: 'The document isn’t finished yet.' }, { status: 409 })
  }

  const sections = currentFinalSections(session)
  const title = finalBlockTitle(block, session.interviewee_type)

  const { data: promptRow } = await supabaseAdmin
    .from('meeting_prep_prompt')
    .select('prompt_text')
    .eq('prompt_key', 'final_document')
    .maybeSingle()
  const promptText = session.final_doc_prompt_snapshot || promptRow?.prompt_text || ''

  const todayStr = new Date().toISOString().slice(0, 10)
  const system = `${promptText}

--- TASK FOR THIS CALL (system rule: overrides the output instructions above) ---
TODAY'S DATE IS ${todayStr}. You are rewriting ONE section of an existing meeting preparation document: "${title}". The sales representative's request is below. Change what they ask for and keep everything else in this section that is still right.
The same rules apply as when the document was written: every factual claim keeps a visible source with its date and URL, nothing negative or reputationally damaging, concise and easy to scan.
Web search: use it only when the request needs information the approved material doesn't contain (a more recent quote, a missing figure, a fact to verify). Otherwise rewrite from the approved material. Anything new you add must carry its source. Search silently.
Your reply is the section's complete new content: whatever you leave out is deleted. Do not repeat the section title and do not write any other section.

${NO_PREAMBLE_INSTRUCTION}`

  const others = FINAL_BLOCKS.filter((b) => b.key !== block)
    .map((b) => `--- ${finalBlockTitle(b.key, session.interviewee_type).toUpperCase()} (another section of the document, for context; do not contradict it) ---\n${sections[b.key] || '(not written)'}`)
    .join('\n\n')
  const points = (session.presentation_points || []).map((p, i) => `${i + 1}. ${p}`).join('\n')

  const user = `--- ADVERTISER HISTORY ---
${advertiserHistoryToPrompt(session)}

${researchSectionsToPrompt(session.research_sections as MeetingPrepResearchSections)}

--- APPROVED PRESENTATION POINTS ---
${points}

--- APPROVED PLANTEO ---
${session.planteo_output || ''}${meetingTypeNoteForDocument(session.interviewee_type)}

${others}

--- CURRENT "${title.toUpperCase()}" (to be replaced) ---
${sections[block] || '(empty: write this section from the approved material)'}

--- SALES REP'S REQUEST ---
${(feedback || '').trim() || 'Improve this section.'}`

  let result: Awaited<ReturnType<typeof streamWithDeadline>>
  try {
    result = await streamWithDeadline({
      model: CLAUDE_MODEL,
      system,
      user,
      maxTokens: 4096,
      maxSearches: MAX_WEB_SEARCHES,
      deadlineMs: SOFT_DEADLINE_MS,
    })
  } catch (err) {
    console.error('Meeting prep block regenerate error:', err)
    await logUsageEvent({
      userId: caller.user.id,
      workflow: 'meeting_prep_document_block',
      sourceId: session.id,
      model: CLAUDE_MODEL,
      status: 'error',
      error: err instanceof Error ? err.message : 'Block regenerate failed',
    })
    return NextResponse.json({ error: 'This section could not be rewritten. Please try again.' }, { status: 500 })
  }

  const totalTokens = result.promptTokens + result.outputTokens
  await addSessionUsage(session.id, { tokensInput: result.promptTokens, tokensOutput: result.outputTokens, webSearches: result.webSearches, cost: result.cost })
  await supabaseAdmin.rpc('increment_user_tokens', { p_user_id: caller.user.id, p_tokens: totalTokens })

  const text = extractAfterMarker(result.text).replace(/^\s*-{3,}\s*$/gm, '').trim()
  const previous = sections[block] || ''
  // A cut-short reply, or one far shorter than what it replaces, would delete
  // content the rep didn't ask to lose: keep the current section — unless
  // shortening is exactly what they asked for.
  const askedShorter = /\b(short|brief|concise|cut|trim|reduc|fewer|condens|remove|delete|drop|only|max)/i.test(feedback || '')
  const problem = result.cutShort
    ? 'This took too long and was stopped. The section is unchanged — try again, or ask for a smaller change.'
    : !text
      ? 'The rewrite came back empty. The section is unchanged — please try again.'
      : !askedShorter && previous.length > 200 && text.length < previous.length * 0.2
        ? 'The rewrite looked incomplete compared to the current section, so it wasn’t saved. Please try again.'
        : null

  await logUsageEvent({
    userId: caller.user.id,
    workflow: 'meeting_prep_document_block',
    sourceId: session.id,
    model: CLAUDE_MODEL,
    tokensInput: result.promptTokens,
    tokensOutput: result.outputTokens,
    tokensTotal: totalTokens,
    webSearches: result.webSearches,
    costUsd: result.cost,
    ...(problem ? { status: 'error' as const, error: problem } : {}),
  })
  if (problem) return NextResponse.json({ error: problem }, { status: 500 })

  const updated = { ...sections, [block]: text }
  await saveFinalSections(session, updated)

  return NextResponse.json({
    block,
    text,
    usage: { tokens_total: totalTokens, web_searches: result.webSearches, cost_usd: result.cost },
  })
}
