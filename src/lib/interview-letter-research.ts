// Server-only helpers for the Interview Letter research step (migration 038).
//
// Research can run on Gemini (Google Search grounding, the default) or Claude
// (web_search tool), chosen by an admin in interview_letter_settings. Every
// write-up — letter, email, personalization — stays on Claude either way.
//
// The Editorial Brief for the project's country, when one exists, is the
// research's primary context: the engine's job is a quick verify-and-update
// pass on top of it, not research from scratch.
//
// Gemini runs in two steps, because one call cannot do both jobs reliably.
// Measured 18 Oct 2026 with the Libya brief: with the whole brief in the
// prompt Gemini searched in 1 of 8 replies (and 2 of 3 with the brief moved
// to the system prompt), answering from the brief instead. Replies with no
// search are unusable (see runGeminiResearch). A short question-only prompt
// searched in 6 of 6 replies, 5–6 queries each. So:
//   1. CHECK (grounded): the questions plus the brief's opening section as
//      "claims to check" → numbered facts "F1 | fact | date | publisher",
//      each linked to the search results behind it.
//   2. SYNTHESIS (no search): admin research prompt + full brief + those
//      facts → HOOK / BULLETS / UPDATES / CAUTIONS, citing facts as [F#].
//      The code swaps each [F#] for that fact's real source links.
import { supabaseAdmin } from '@/lib/supabase/admin'
import { callGemini, GeminiError, type GeminiResult } from '@/lib/country-intel/gemini'
import { groundingLinks, type SourceLink } from '@/lib/gemini/grounding'
import { fillPromptPlaceholders } from '@/lib/interview-letters'
import type { InterviewLetterResearchProvider } from '@/types'

// Moved to lib/gemini/grounding.ts (shared with the Interview Tool's Gemini
// web research); re-exported so existing imports keep working.
export { geminiConfigured, groundingLinks, type SourceLink } from '@/lib/gemini/grounding'

export const GEMINI_RESEARCH_MODEL = process.env.INTERVIEW_LETTER_GEMINI_MODEL || 'gemini-3.8-flash'

// The brief is the primary context, so Gemini's synthesis gets all of it (a
// full brief is ~100k characters ≈ 25k tokens, about $0.02 on Flash). Claude's
// web search re-sends every result page on each turn, so it gets a shorter
// cut. The CHECK step only sees the opening section (summary, key figures,
// publication window): enough claims to verify without discouraging search.
export const BRIEF_CHARS_FOR_GEMINI = 150_000
export const BRIEF_CHARS_FOR_CLAUDE = 60_000
const BRIEF_CHARS_FOR_CHECK = 6_000

export async function getResearchProvider(): Promise<InterviewLetterResearchProvider> {
  const { data } = await supabaseAdmin
    .from('interview_letter_settings')
    .select('research_provider')
    .eq('id', 1)
    .maybeSingle()
  return data?.research_provider === 'claude' ? 'claude' : 'gemini'
}

interface ProjectLike {
  company: string
  project_country: string
  media_partner: string
  media_partner_country?: string | null
  hook_input?: string | null
  letter_variant?: string | null
  anchor?: string | null
  publication_timing?: string | null
  report_sector?: string | null
}

type Brief = { title: string; text: string } | null

// Values for the {{PLACEHOLDER}} tokens admins write into the research prompt.
export function researchPromptVars(p: ProjectLike): Record<string, string> {
  const userContext = [
    p.letter_variant === 'anchor' && p.anchor?.trim() ? `Anchor: ${p.anchor.trim()}` : '',
    p.publication_timing?.trim() ? `Publication timing: ${p.publication_timing.trim()}` : '',
    p.hook_input?.trim() || '',
  ].filter(Boolean).join('\n')
  return {
    COMPANY: p.company,
    PROJECT_COUNTRY: p.project_country,
    MEDIA_PARTNER: p.media_partner,
    TARGET_MARKET: p.media_partner_country || 'N/A',
    USER_CONTEXT: userContext || '(none supplied)',
    CURRENT_DATE: new Date().toISOString().slice(0, 10),
    ANCHOR: p.anchor || '(none)',
    PUBLICATION_TIMING: p.publication_timing || '(not confirmed)',
    REPORT_SECTOR: p.report_sector || '(not specified)',
  }
}

// The questions every research run must answer with fresh search results.
function researchQuestions(p: ProjectLike): string[] {
  const country = p.project_country
  return [
    `What are the most important economic, political and investment developments in ${country} in the last three months?`,
    p.report_sector?.trim() ? `What is the latest on ${country}'s ${p.report_sector.trim()} sector?` : '',
    p.letter_variant === 'anchor' && p.anchor?.trim() ? `What are the confirmed details (exact name, dates, place) of: ${p.anchor.trim()}?` : '',
    p.media_partner_country?.trim() ? `What is the latest on relations, trade and investment between ${country} and ${p.media_partner_country.trim()}?` : '',
    `What are ${country}'s latest GDP growth, trade, FDI and investment-target figures?`,
  ].filter(Boolean)
}

function projectDetails(p: ProjectLike): string {
  return `--- PROJECT DETAILS ---
Company: ${p.company}
Project country: ${p.project_country}
Report sector / theme: ${p.report_sector?.trim() || '(not specified)'}
Letter version: ${p.letter_variant === 'anchor' ? `With an anchor: ${p.anchor?.trim() || '(not supplied)'}` : 'Without an anchor'}
Publication timing: ${p.publication_timing?.trim() || '(not confirmed)'}
Media partner: ${p.media_partner}
Media partner country / target market: ${p.media_partner_country?.trim() || 'N/A'}
Additional context from the editor: ${p.hook_input?.trim() || '(none)'}`
}

// System prompt for the single Claude call or for Gemini's SYNTHESIS step.
export function buildResearchSystem(adminPrompt: string, p: ProjectLike, opts: { provider: InterviewLetterResearchProvider; hasBrief: boolean }): string[] {
  const filled = adminPrompt ? fillPromptPlaceholders(adminPrompt, researchPromptVars(p)) : ''
  return [researchPolicy(opts.provider), filled, researchOutputContract(p, opts)].filter(Boolean)
}

function researchPolicy(provider: InterviewLetterResearchProvider): string {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const sourcing = provider === 'gemini'
    ? 'The current facts have already been searched for you: they are the VERIFIED FACTS in the user message, each found in today’s Google Search results. Rely on those for anything current; your own knowledge is out of date.'
    : 'Use web search for every current fact; your own knowledge is out of date.'
  return `--- RESEARCH POLICY (MANDATORY) ---
TODAY'S DATE IS ${today}. The current year is ${now.getFullYear()}. ${sourcing}

Research only what an Interview Request Letter needs: a handful of short, sourced, letter-relevant facts, not a general country dossier. Prefer primary and authoritative sources (government, central bank, statistics office, investment agency, multilateral bodies, official event sites). If something cannot be verified, leave it out or list it under CAUTIONS rather than guessing.

Work silently: do not narrate your plan. Go straight to the output.`
}

// Placed LAST in the system prompt so it overrides any output format the
// admin prompt describes (same "contract last" pattern as the document
// module's OUTPUT_CONTRACT). The admin prompt still owns what to research and
// how to judge it; the code owns the shape the app parses.
export function researchOutputContract(p: ProjectLike, opts: { provider: InterviewLetterResearchProvider; hasBrief: boolean }): string {
  const cite = opts.provider === 'gemini'
    ? 'End each line with the tags of the VERIFIED FACTS it relies on, e.g. "[F3]" or "[F3, F7]" (the system turns them into source links), or "(Editorial Brief)" for a fact taken only from the brief. Never type URLs.'
    : 'End each line with a markdown link to the page you found it on, e.g. "[Reuters, 12 October 2026](https://…)", or "(Editorial Brief)" for a fact taken only from the brief.'

  const brief = opts.hasBrief
    ? `An Editorial Brief for this report is in the user message. It is the PRIMARY reference for the report's focus, angle, themes and context, so build on it rather than starting from scratch. Your job is a quick check on top of it: verify its letter-relevant facts, correct anything outdated, and add important developments since it was written. Where a newer sourced fact contradicts the brief, the newer fact wins: use it, and say so under UPDATES.`
    : `No Editorial Brief exists for this report, so research it from scratch within the scope above.`

  const anchor = (p.anchor || '').trim()
  const version = p.letter_variant === 'anchor'
    ? `This report HAS AN ANCHOR: "${anchor || 'see the user-supplied context'}". Verify its exact name, dates and place. The HOOK must be built around this anchor and explain how it connects to the report. Do not replace it with a different event.`
    : `This report has NO ANCHOR event. The HOOK states the report's purpose and why it is timely now, drawn from ${opts.hasBrief ? 'the brief and ' : ''}verified recent developments. Do not invent or force an event. Mention publication timing only if it is confirmed.`

  return `--- OUTPUT CONTRACT (overrides any output format described above) ---
${brief}

${version}

Do not research or describe the media partner publication. Its description is supplied word for word by the editors.

Deliver your answer as exactly these four sections, each introduced by its marker on a line of its own, in this order, with nothing before the first marker and nothing after the last section:

<<<HOOK>>>
One paragraph of 35–60 words, ready to guide the letter: the recommended why-now hook${p.letter_variant === 'anchor' ? ' built on the anchor' : ' (the report’s purpose and why it is timely)'}.

<<<BULLETS>>>
6–9 lines, each starting with "- ": one verified, letter-relevant fact with its date or period and, briefly, why it matters to the report. ${cite}

<<<UPDATES>>>
Lines starting with "- ": what has changed or is new compared with the Editorial Brief, each with its date. ${cite} ${opts.hasBrief ? 'Write "- None" if nothing material has changed.' : 'Write "- None" (there is no brief to compare against).'}

<<<CAUTIONS>>>
Lines starting with "- ": unverified or conflicting information, targets or forecasts that must not be presented as results, planned events that need careful wording, facts likely to change before publication. Write "- None" if there are none.`
}

// User turn for the single Claude call (it searches as it goes).
export function buildClaudeResearchUserContent(p: ProjectLike, brief: Brief): string {
  const questions = [...researchQuestions(p), brief ? 'Are the key figures, targets and dates in the Editorial Brief below still current?' : ''].filter(Boolean)
  return `STEP 1: Use web search now. Run several searches for the latest facts this letter needs; do not rely on memory${brief ? ' or on the brief alone' : ''}. Answer these questions:
${questions.map((q) => `- ${q}`).join('\n')}
STEP 2: Only after searching, answer exactly as the OUTPUT CONTRACT specifies.

${projectDetails(p)}
${brief ? `\n--- EDITORIAL BRIEF: ${brief.title} (primary reference) ---\n${brief.text}` : ''}`
}

// Gemini step 1 — CHECK. Question-style and short on purpose (see the header).
export function buildCheckPrompt(p: ProjectLike, brief: Brief): { system: string; user: string } {
  const today = new Date().toISOString().slice(0, 10)
  const claims = brief
    ? `\n\nAlso check whether these claims from the internal Editorial Brief are still accurate, and report the current facts (especially anything that has changed):\n${brief.text.slice(0, BRIEF_CHARS_FOR_CHECK)}`
    : ''
  return {
    system: `You are a fact-checking researcher. Today is ${today}. Use Google Search for every answer; never answer from memory. Report only facts you found in search results, each with its date. Prefer primary and authoritative sources (government, central bank, statistics office, investment agency, multilateral bodies, official event sites) and recent reporting from established news outlets.`,
    user: `STEP 1: Use the Google Search tool now. Run several searches (in English and, where useful, the local language) for the current facts below. Do not rely on memory.
STEP 2: Only after searching, answer.

Questions:
${researchQuestions(p).map((q, i) => `${i + 1}. ${q}`).join('\n')}${claims}

Answer as plain lines, one fact per line, each starting with "F" and a number: "F1 | fact | date | publisher". 8–15 lines. No other text.`,
  }
}

// Gemini step 2 — SYNTHESIS (no search). The facts carry their tags.
export function buildSynthesisUserContent(p: ProjectLike, brief: Brief, facts: string[]): string {
  return `${projectDetails(p)}

--- VERIFIED FACTS (from today's Google Search; cite them by tag) ---
${facts.join('\n') || '(none found)'}
${brief ? `\n--- EDITORIAL BRIEF: ${brief.title} (primary reference) ---\n${brief.text}` : ''}

Answer exactly as the OUTPUT CONTRACT specifies.`
}

export interface GeminiResearchOutcome {
  text: string
  // Source links for each verified fact, by tag ("F3").
  factLinks: Map<string, SourceLink[]>
  costUsd: number
  promptTokens: number
  outputTokens: number
  searches: number
}

type Spend = Omit<GeminiResearchOutcome, 'text' | 'factLinks'>

export class GeminiResearchError extends Error {
  constructor(message: string, public spent: Spend) {
    super(message)
  }
}

function addSpend(spent: Spend, r: GeminiResult) {
  const u = r.usage
  spent.costUsd += r.costUsd
  spent.promptTokens += (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0)
  spent.outputTokens += (u.candidatesTokenCount ?? Math.ceil(r.text.length / 3)) + (u.thoughtsTokenCount || 0)
  spent.searches += r.queries.length
}

const FACT_LINE_RE = /^\s*(?:[-*•]\s*)?(F\d+)\s*[|:.)-]\s*(.+)$/

// Runs CHECK then SYNTHESIS (see the header). A CHECK reply with no
// webSearchQueries is never used: in the Country Intelligence run such replies
// were confirmed to be written from memory and fabricated. Spend from every
// attempt is returned (or carried on the error) so the caller bills all of it.
//
// No early abort on CHECK, unlike Country Intelligence: its first-chunk
// heuristic (a grounded reply carries no candidatesTokenCount yet) rejected
// every grounded reply to these prompts in testing. A skipped-search reply to
// this short prompt costs well under a cent anyway.
export async function runGeminiResearch(opts: {
  check: { system: string; user: string }
  synthesis: { system: string; user: (facts: string[]) => string }
  deadline: number
  onStep?: (step: 'searching' | 'synthesising') => void
}): Promise<GeminiResearchOutcome> {
  const spent: Spend = { costUsd: 0, promptTokens: 0, outputTokens: 0, searches: 0 }
  const timeLeft = () => opts.deadline - Date.now()

  // 1. CHECK
  let check: GeminiResult | null = null
  let lastReason = 'out of time'
  for (let attempt = 1; attempt <= 3 && !check; attempt++) {
    if (timeLeft() < 60_000) break
    opts.onStep?.('searching')
    try {
      const r = await callGemini({
        model: GEMINI_RESEARCH_MODEL,
        system: opts.check.system,
        user: opts.check.user,
        maxOutputTokens: 6000,
        grounded: true,
        earlyAbort: false,
        thinkingLevel: 'low',
        timeoutMs: Math.min(timeLeft() - 45_000, 60_000),
      })
      addSpend(spent, r)
      if (r.queries.length && r.text.trim()) check = r
      else lastReason = 'the reply came back without searching Google'
    } catch (e) {
      if (e instanceof GeminiError) {
        spent.costUsd += e.billedUsd
        lastReason = e.message
        if (e.retryable) continue
      }
      throw new GeminiResearchError(e instanceof Error ? e.message : 'Gemini research failed', spent)
    }
  }
  if (!check) throw new GeminiResearchError(`The Gemini research check did not complete (${lastReason}). Please try again.`, spent)

  const factLines = check.text.split('\n').filter((l) => FACT_LINE_RE.test(l)).map((l) => l.trim().replace(/^[-*•]\s*/, ''))
  const linked = await groundingLinks(factLines, check)
  const factLinks = new Map<string, SourceLink[]>()
  factLines.forEach((line, i) => {
    if (linked[i].length) factLinks.set(line.match(FACT_LINE_RE)![1].toUpperCase(), linked[i])
  })

  // 2. SYNTHESIS
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (timeLeft() < 25_000) break
    opts.onStep?.('synthesising')
    try {
      const r = await callGemini({
        model: GEMINI_RESEARCH_MODEL,
        system: opts.synthesis.system,
        user: opts.synthesis.user(factLines),
        maxOutputTokens: 8000,
        grounded: false,
        thinkingLevel: 'low',
        timeoutMs: Math.min(timeLeft() - 15_000, 90_000),
      })
      addSpend(spent, r)
      if (r.text.trim()) return { text: r.text, factLinks, ...spent }
      lastReason = 'the summary came back empty'
    } catch (e) {
      if (e instanceof GeminiError) {
        spent.costUsd += e.billedUsd
        lastReason = e.message
        if (e.retryable) continue
      }
      throw new GeminiResearchError(e instanceof Error ? e.message : 'Gemini research failed', spent)
    }
  }
  throw new GeminiResearchError(`The Gemini research summary did not complete (${lastReason}). Please try again.`, spent)
}

const MAX_LINKS_PER_LINE = 3

// Swaps "[F3]" / "[F3, F7]" / "(F3)" tags for the facts' source links, one per
// site and at most three per line. Tags with no links behind them are dropped
// rather than shown raw.
export function linkFactTags(line: string, factLinks: Map<string, SourceLink[]>): string {
  const links: SourceLink[] = []
  const stripped = line.replace(/\s*[[(]\s*(F\d+(?:\s*[,;&]\s*F\d+)*)\s*[\])]/gi, (_m, tags: string) => {
    for (const tag of tags.split(/[,;&]/)) {
      for (const l of factLinks.get(tag.trim().toUpperCase()) || []) {
        if (links.length < MAX_LINKS_PER_LINE && !links.some((x) => x.title === l.title)) links.push(l)
      }
    }
    return ''
  })
  return links.length ? `${stripped.trim()} ${links.map((l) => `[${l.title}](${l.url})`).join(' ')}` : stripped.trim()
}
