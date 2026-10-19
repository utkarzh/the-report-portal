// Server-only: who does the web research for the Interview Tool's Background
// Research (migration 040, client request 19 Oct 2026).
//
// Admins choose in Interview Tool → Admin tools → Research engine:
//   • 'claude' (the default): Claude's web_search tool researches and writes
//     in one call, exactly as before (api/generate/route.ts).
//   • 'gemini': Gemini with Google Search grounding does the searching and
//     hands Claude dated, sourced facts. Claude writes the research from them
//     under the same General + Category prompts. Claude writes the interview
//     questions either way.
//
// Gemini runs in two steps (runGeminiWebResearch):
//   1. PLAN (no search). The category prompt (the interview's themes and each
//      theme's research targets) becomes 4–5 search lanes of concrete
//      questions about this interviewee. Category prompts run to 25–30k
//      characters, and the Interview Letter tests (18 Oct 2026) showed that a
//      grounded Gemini call with a long prompt stops searching and answers
//      from memory, so the category prompt never goes to a grounded call.
//      If this step fails, a fixed plan (defaultLanes) is searched instead.
//   2. SEARCH (grounded, one call per lane, all in parallel). Short
//      question-only prompts, the shape that searched in 6 of 6 replies in
//      those tests. Each lane answers "F1 | fact | date | publisher" lines,
//      and each line is linked to the Google results behind it. A reply with
//      no webSearchQueries is never used: in the Country Intelligence run such
//      replies were confirmed to be fabricated.
import { supabaseAdmin } from '@/lib/supabase/admin'
import { callGemini, extractJson, GeminiError, type GeminiResult } from '@/lib/country-intel/gemini'
import { groundingLinks, type SourceLink } from '@/lib/gemini/grounding'
import { isMissingTable } from '@/lib/knowledge/schema-compat'
import type { ResearchProvider } from '@/types'

export const RESEARCH_GEMINI_MODEL = process.env.RESEARCH_GEMINI_MODEL || 'gemini-3.8-flash'

const MAX_LANES = 5
const MAX_QUESTIONS_PER_LANE = 6
const LANE_ATTEMPTS = 3
const MAX_LINKS_PER_FACT = 3
// Fewer facts than this is too thin to write a 10-theme research from.
const MIN_FACTS = 8

// ------------------------------------------------------------
// The admin setting
// ------------------------------------------------------------

// Anything unexpected, including a database that hasn't run 040 yet, reads as
// Claude: the behaviour before this setting existed.
export async function readResearchSettings(): Promise<{ provider: ResearchProvider; installed: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('research_settings')
    .select('research_provider')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    if (!isMissingTable(error)) console.error('Failed to read research_settings:', error)
    return { provider: 'claude', installed: !isMissingTable(error) }
  }
  return { provider: data?.research_provider === 'gemini' ? 'gemini' : 'claude', installed: true }
}

export async function getInterviewToolResearchProvider(): Promise<ResearchProvider> {
  return (await readResearchSettings()).provider
}

// PostgREST answers PGRST204 when an UPDATE names a column that doesn't exist
// (42703 for a SELECT), e.g. research_sessions.research_provider before 040.
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false
  const msg = error.message ?? ''
  return msg.includes(column) && (error.code === 'PGRST204' || error.code === '42703' || /does not exist|could not find/i.test(msg))
}

// ------------------------------------------------------------
// Gemini web research
// ------------------------------------------------------------

export interface ResearchSubject {
  fullName: string
  titlePosition: string
  companyOrg: string
  countryFocus: string
  publication: string
  mediaPartnerCountry: string
  categoryName: string
}

interface Lane {
  title: string
  themes: string[]
  questions: string[]
}

export interface WebFact {
  // "fact | date | publisher", as Gemini wrote it.
  body: string
  links: SourceLink[]
}

export interface LaneResult {
  title: string
  themes: string[]
  facts: WebFact[]
  // Google searches run for this lane (every attempt) and the queries of the
  // reply that was used.
  searches: number
  queries: string[]
  // Why the lane came back empty, when it did.
  failure: string | null
}

// Live progress for the waiting screen: the plan, then each lane as it lands.
export type GeminiProgress =
  | { kind: 'plan'; lanes: string[] }
  | { kind: 'lane'; index: number; facts: number; searches: number; queries: string[]; sources: string[] }

export interface GeminiWebResearch {
  lanes: LaneResult[]
  factCount: number
  // false when the category prompt couldn't be turned into a plan and the
  // fixed plan was searched instead.
  planned: boolean
}

export interface GeminiSpend {
  costUsd: number
  promptTokens: number
  outputTokens: number
  searches: number
}

export function emptySpend(): GeminiSpend {
  return { costUsd: 0, promptTokens: 0, outputTokens: 0, searches: 0 }
}

const today = () => new Date().toISOString().slice(0, 10)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The publication's home market, when it differs from the country in focus.
function partnerCountry(s: ResearchSubject): string {
  const mp = s.mediaPartnerCountry.trim()
  return mp && mp.toLowerCase() !== s.countryFocus.trim().toLowerCase() ? mp : ''
}

function appointmentQuestion(s: ResearchSubject): string {
  return `Does ${s.fullName} still hold the role of ${s.titlePosition} at ${s.companyOrg} today, and when did they take up this CURRENT role? Find the official appointment announcement (search "${s.fullName} appointed" without a year), any re-appointment, second term or interim period, and who held the role immediately before them. Confirm the date with two independent sources where possible.`
}

function macroQuestion(s: ResearchSubject): string {
  const mp = partnerCountry(s)
  return `What are ${s.countryFocus}'s latest official figures for GDP growth, foreign direct investment and trade${mp ? `, including bilateral trade with ${mp}` : ''}, and which period does each cover?`
}

function riskQuestion(s: ResearchSubject): string {
  return `Are ${s.fullName} or ${s.companyOrg} linked to any sanctions, criminal or regulatory investigations, court cases, corruption allegations or other major controversies? If credible sources show none, say so.`
}

// Used when the category prompt can't be turned into a plan (or is empty).
// Generic enough for every category: "scale" names budget and output as well
// as revenue so it fits a ministry, a port or a zone too.
function defaultLanes(s: ResearchSubject): Lane[] {
  const mp = partnerCountry(s)
  return [
    {
      title: 'The interviewee',
      themes: ['Current role and tenure', 'Vision and personal contribution'],
      questions: [
        appointmentQuestion(s),
        `What did ${s.fullName} do before this role (earlier positions and education)?`,
        `What has ${s.fullName} said publicly in the last 12 months (interviews, speeches, statements), and which strategic decisions or initiatives have they led?`,
      ],
    },
    {
      title: s.companyOrg,
      themes: ['What it does and how it is perceived', 'Scale and market position', 'Growth', 'Recent successes'],
      questions: [
        `What does ${s.companyOrg} do: its main activities, products or services, customers and markets?`,
        `What are ${s.companyOrg}'s latest scale and performance figures (for example revenue, profit, assets, employees, capacity, output or budget), and how have they changed on the previous period?`,
        `What major contracts, projects, investments, partnerships, launches or awards has ${s.companyOrg} announced in the last 16 months, and what is the current status of each?`,
      ],
    },
    {
      title: `${s.companyOrg}: innovation and sustainability`,
      themes: ['Innovation', 'Sustainability'],
      questions: [
        `What technology, digitalisation or innovation initiatives does ${s.companyOrg} have, and what results have they delivered?`,
        `What sustainability initiatives, targets and measured results does ${s.companyOrg} report?`,
      ],
    },
    {
      title: mp ? `${s.countryFocus} and ${mp}` : s.countryFocus,
      themes: [mp ? `Links with ${mp}` : 'International links', 'Investment appeal', 'Editorial risk check'],
      questions: [
        ...(mp ? [`What investments, partnerships, trade or agreements link ${s.companyOrg} and ${s.countryFocus} with ${mp}?`] : []),
        macroQuestion(s),
        `What major reforms, investment programmes or policies affecting ${s.companyOrg}'s sector has ${s.countryFocus} announced in the last 12 months?`,
        riskQuestion(s),
      ],
    },
  ]
}

function planPrompt(s: ResearchSubject, categoryPrompt: string, extra: string): { system: string; user: string } {
  const mp = partnerCountry(s)
  return {
    system: 'You plan the web research for an editorial team preparing an executive interview. You do not search: you write the questions that a researcher with Google Search will answer. Reply with JSON only.',
    user: `Today: ${today()}
Interviewee: ${s.fullName}, ${s.titlePosition}, ${s.companyOrg}
Country in focus: ${s.countryFocus}
Publication: ${s.publication}${mp ? `, read mainly by business readers in ${mp}` : ''}
Interview category: ${s.categoryName}${extra ? `\nThe editor's notes for this research: ${extra.slice(0, 1500)}` : ''}

The category brief below lists the interview's themes in order and, for each theme, what to research. Turn it into a search plan for THIS interviewee:
- ${MAX_LANES - 1} or ${MAX_LANES} lanes. Each lane groups related themes and has 3 to ${MAX_QUESTIONS_PER_LANE} questions.
- Together, the questions must cover every theme's research targets, in the brief's theme order.
- Write every question as a self-contained web-search question that names the actual person, organisation and countries. Never use placeholders such as [ORG].
- Always include: (1) whether ${s.fullName} still holds the role today and when they took up the CURRENT role (the appointment announcement, any re-appointment or interim period, the predecessor); (2) the latest official figures for ${s.countryFocus} (GDP growth, FDI${mp ? `, trade with ${mp}` : ''}); (3) any sanctions, investigations, court cases or controversies involving ${s.fullName} or ${s.companyOrg}.
- Ask only for facts. No instructions about writing, wording or formatting.

Reply with JSON only, in this shape:
{"lanes":[{"title":"short lane name","themes":["theme names from the brief"],"questions":["…"]}]}

--- CATEGORY BRIEF ---
${categoryPrompt}`,
  }
}

const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)

function parsePlan(text: string): Lane[] {
  const json = extractJson<{ lanes?: unknown }>(text)
  const raw = Array.isArray(json?.lanes) ? json.lanes : []
  return raw
    .map((l) => {
      const o = (l ?? {}) as Record<string, unknown>
      return {
        title: typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 80) : 'Research',
        themes: strings(o.themes).slice(0, 6).map((t) => t.slice(0, 80)),
        questions: strings(o.questions).slice(0, MAX_QUESTIONS_PER_LANE).map((q) => q.slice(0, 400)),
      }
    })
    .filter((l) => l.questions.length > 0)
    .slice(0, MAX_LANES)
}

// The three checks the General Prompt never lets the research skip. The plan
// is asked for them; this makes sure, without adding a lane.
function ensureMandatoryQuestions(lanes: Lane[], s: ResearchSubject) {
  const all = lanes.flatMap((l) => l.questions).join('\n')
  if (!/appoint|took (?:up )?(?:office|the (?:role|post|position))|tenure|took over/i.test(all)) {
    lanes[0].questions.unshift(appointmentQuestion(s))
  }
  const last = lanes[lanes.length - 1]
  if (!/\bGDP\b|gross domestic|\bFDI\b|foreign direct investment/i.test(all)) last.questions.push(macroQuestion(s))
  if (!/sanction|investigat|lawsuit|litigation|court|controvers|allegation|scandal|corruption/i.test(all)) last.questions.push(riskQuestion(s))
}

function addSpend(spent: GeminiSpend, r: GeminiResult) {
  const u = r.usage
  spent.costUsd += r.costUsd
  spent.promptTokens += (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0)
  spent.outputTokens += (u.candidatesTokenCount ?? Math.ceil(r.text.length / 3)) + (u.thoughtsTokenCount || 0)
  spent.searches += r.queries.length
}

async function planLanes(
  opts: { subject: ResearchSubject; categoryPrompt: string; extra: string; spent: GeminiSpend },
  timeLeft: () => number,
): Promise<{ lanes: Lane[]; planned: boolean }> {
  if (opts.categoryPrompt.trim()) {
    const prompt = planPrompt(opts.subject, opts.categoryPrompt, opts.extra)
    try {
      const r = await callGemini({
        model: RESEARCH_GEMINI_MODEL,
        system: prompt.system,
        user: prompt.user,
        maxOutputTokens: 4000,
        grounded: false,
        thinkingLevel: 'low',
        timeoutMs: Math.max(5_000, Math.min(30_000, timeLeft() - 60_000)),
      })
      addSpend(opts.spent, r)
      const lanes = parsePlan(r.text)
      if (lanes.length >= 2) return { lanes, planned: true }
      console.warn('Gemini research plan was unusable; searching the fixed plan instead')
    } catch (e) {
      if (e instanceof GeminiError) opts.spent.costUsd += e.billedUsd
      console.warn('Gemini research plan failed; searching the fixed plan instead:', e instanceof Error ? e.message : e)
    }
  }
  return { lanes: defaultLanes(opts.subject), planned: false }
}

function lanePrompt(lane: Lane, s: ResearchSubject): { system: string; user: string } {
  const mp = partnerCountry(s)
  const themes = Math.max(1, lane.themes.length)
  const min = Math.min(14, Math.max(6, 4 * themes))
  const max = Math.min(24, Math.max(10, 8 * themes))
  return {
    system: `You are a fact-finding researcher preparing background research for a business journalist's interview. Today is ${today()}. Use Google Search for every answer; never answer from memory, which is out of date.
- Report only facts you found in today's search results, each with the date of the event or the period the data covers.
- Report the latest data: before giving a figure, check whether a newer year, quarter or report exists, and give the newest.
- Keep each fact's status exact: announced, planned, signed, under construction, completed, cancelled. A target or forecast is not a result.
- Make sure each fact belongs to the exact organisation, not its parent, a subsidiary or the whole sector. Write "sector-level" when it is about the sector.
- Prefer official sources (the organisation itself, government, regulators, statistics offices, central banks, stock-exchange filings, IMF, World Bank) and established news outlets. Never use Wikipedia, social media, forums or blogs.
- If sources conflict, or only one weak source exists, start the fact with "UNCONFIRMED:" and say why.`,
    user: `STEP 1: Use the Google Search tool now. Run several searches (in English and, where useful, the local language of ${s.countryFocus}) for the questions below. Do not rely on memory.
STEP 2: Only after searching, answer.

Interviewee: ${s.fullName}, ${s.titlePosition}, ${s.companyOrg} (${s.countryFocus})
Publication: ${s.publication}${mp ? `, read mainly in ${mp}` : ''}

${lane.title}${themesLabel(lane.themes)}
${lane.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Answer as plain lines, one fact per line, each starting with "F" and a number: "F1 | fact | date | publisher". ${min}–${max} lines. No other text.`,
  }
}

const themesLabel = (themes: string[]) => (themes.length ? ` (${themes.join('; ')})` : '')

const FACT_LINE_RE = /^\s*(?:[-*•]\s*)?\**\s*F\d+\s*\**\s*[|:.)-]\s*(.+)$/

function factLines(text: string): { raw: string; body: string }[] {
  return text
    .split('\n')
    .map((raw) => ({ raw, m: raw.match(FACT_LINE_RE) }))
    .filter((x): x is { raw: string; m: RegExpMatchArray } => Boolean(x.m))
    .map(({ raw, m }) => ({ raw, body: m[1].replace(/^\|\s*/, '').replace(/\*+$/, '').trim() }))
    .filter((f) => f.body.length > 0)
}

async function searchLane(lane: Lane, s: ResearchSubject, spent: GeminiSpend, timeLeft: () => number): Promise<LaneResult> {
  const prompt = lanePrompt(lane, s)
  let failure = 'ran out of time'
  let searches = 0
  for (let attempt = 1; attempt <= LANE_ATTEMPTS; attempt++) {
    if (timeLeft() < 20_000) break
    try {
      const r = await callGemini({
        model: RESEARCH_GEMINI_MODEL,
        system: prompt.system,
        user: prompt.user,
        maxOutputTokens: 6000,
        grounded: true,
        // Off for the same reason as the Interview Letter CHECK: the
        // first-chunk heuristic rejected every grounded reply to these short
        // prompts, and a skipped-search reply to them costs well under a cent.
        earlyAbort: false,
        thinkingLevel: 'low',
        timeoutMs: Math.min(timeLeft() - 5_000, 75_000),
      })
      addSpend(spent, r)
      searches += r.queries.length
      if (!r.queries.length) {
        failure = 'the reply came back without searching Google'
        continue
      }
      const lines = factLines(r.text)
      if (!lines.length) {
        failure = 'the reply had no facts in the expected format'
        continue
      }
      const links = await groundingLinks(lines.map((l) => l.raw), r, { keepUnresolved: false })
      return {
        title: lane.title,
        themes: lane.themes,
        facts: lines.map((l, i) => ({ body: l.body, links: links[i] })),
        searches,
        queries: r.queries,
        failure: null,
      }
    } catch (e) {
      if (e instanceof GeminiError) {
        spent.costUsd += e.billedUsd
        failure = e.message
        if (e.retryable) {
          await sleep(Math.min(2_000 * attempt, Math.max(0, timeLeft() - 25_000)))
          continue
        }
      } else {
        failure = e instanceof Error ? e.message : String(e)
      }
      break
    }
  }
  console.warn(`Gemini research lane "${lane.title}" came back empty: ${failure}`)
  return { title: lane.title, themes: lane.themes, facts: [], searches, queries: [], failure }
}

// Plans, then searches every lane in parallel. Never throws for a Gemini
// failure: an empty lane carries its reason and geminiResearchProblem()
// decides whether the result is usable. `spent` accumulates every call's cost
// as it happens, so the caller can bill it whatever the outcome.
export async function runGeminiWebResearch(opts: {
  subject: ResearchSubject
  categoryPrompt: string
  extra: string
  deadline: number
  spent: GeminiSpend
  onProgress?: (p: GeminiProgress) => void
}): Promise<GeminiWebResearch> {
  const timeLeft = () => opts.deadline - Date.now()
  const { lanes, planned } = await planLanes(opts, timeLeft)
  ensureMandatoryQuestions(lanes, opts.subject)
  opts.onProgress?.({ kind: 'plan', lanes: lanes.map((l) => l.title) })
  const results = await Promise.all(
    lanes.map(async (lane, index) => {
      const r = await searchLane(lane, opts.subject, opts.spent, timeLeft)
      opts.onProgress?.({
        kind: 'lane',
        index,
        facts: r.facts.length,
        searches: r.searches,
        queries: r.queries.slice(0, 8),
        sources: [...new Set(r.facts.flatMap((f) => f.links.slice(0, MAX_LINKS_PER_FACT).map((x) => hostOf(x.url))))],
      })
      return r
    }),
  )
  return { lanes: results, planned, factCount: results.reduce((n, l) => n + l.facts.length, 0) }
}

// Why the research is too thin to write from (null when it's usable). Thin
// research falls back to Claude's own web search instead of writing N/A
// across whole themes.
export function geminiResearchProblem(r: GeminiWebResearch): string | null {
  const empty = r.lanes.filter((l) => !l.facts.length)
  const why = empty.map((l) => `${l.title}: ${l.failure}`).join('; ').slice(0, 400)
  if (r.factCount < MIN_FACTS) return `only ${r.factCount} facts came back${why ? ` (${why})` : ''}`
  if (empty.length * 2 > r.lanes.length) return `${empty.length} of ${r.lanes.length} search lanes came back empty (${why})`
  return null
}

// ------------------------------------------------------------
// The Claude write-up
// ------------------------------------------------------------

// Placed LAST in the system prompt, after the admin's General Prompt, so it
// overrides that prompt's own "search / verify / check LinkedIn" steps (same
// "contract last" pattern as generate-questions' TOPIC_OUTLINE_FORMAT_CONTRACT).
// The General Prompt still owns what the research covers and how it reads.
export function geminiWriteUpRules(now = new Date()): string {
  const year = now.getFullYear()
  return `--- WEB RESEARCH FOR THIS RUN (MANDATORY — overrides any instruction above about searching or verifying) ---
TODAY'S DATE IS ${now.toISOString().slice(0, 10)}. The current year is ${year}. Your training data is OUT OF DATE; assume anything you "remember" may have changed.

The web research for this interview has already been done with Google Search. Its results are the WEB RESEARCH section at the end of the user message: numbered facts, each with its date, its publisher and the pages it came from. You have no web search or browsing in this step. Wherever the instructions above or the category prompt tell you to search, verify, re-check, look for a newer figure or check LinkedIn, that work has been done: build the research from the WEB RESEARCH. Never claim that you searched, browsed or verified anything yourself, and never describe this process.

SOURCE RULES:
- The WEB RESEARCH and any attached company documents are your only sources for anything current. Never fill a gap from memory: if they do not establish something, write N/A, as the instructions above require. Your own knowledge is acceptable ONLY for clearly labelled pre-${year - 1} historical or biographical background.
- A fact marked UNCONFIRMED stays unconfirmed: use the manual-review wording the instructions above require (for example for an appointment date), never present it as settled, and never derive anything from it.
- Where two facts conflict, prefer the more recent and more authoritative one. If the conflict cannot be resolved, do not present either as established.
- Cite every fact with the URL listed under it in the WEB RESEARCH, copied exactly, in the citation format the instructions above require. If a fact has no URL, give its publisher and date instead. Never write a URL that is not listed in the WEB RESEARCH or the attached documents.
- Write only the finished research. Do not mention the fact tags (F1, F2…), Gemini, Google Search or how the facts were gathered.
- The research is downloaded and may be shared as it is: start directly with its first heading, with nothing before it (no introduction, no notes).`
}

// The WEB RESEARCH block for the end of the write-up's user message. Facts are
// renumbered across lanes so every tag is unique.
export function renderWebResearch(r: GeminiWebResearch): string {
  let n = 0
  const sections = r.lanes
    .filter((l) => l.facts.length)
    .map((l) => {
      const facts = l.facts.map((f) => {
        n += 1
        const urls = f.links.slice(0, MAX_LINKS_PER_FACT).map((x) => x.url)
        return `F${n} | ${f.body}${urls.length ? `\n    Sources: ${urls.join(' ; ')}` : ''}`
      })
      return `### ${l.title}${themesLabel(l.themes)}\n${facts.join('\n')}`
    })
  const empty = r.lanes.filter((l) => !l.facts.length)
  const gaps = empty.length
    ? `\n\nNo search results came back for: ${empty.map((l) => `${l.title}${themesLabel(l.themes)}`).join('; ')}. Write N/A for whatever those would have covered; never fill it from memory.`
    : ''
  return `--- WEB RESEARCH (Google Search, ${today()}) ---
Each line: tag | fact | date | publisher, followed by the pages the fact came from.

${sections.join('\n\n')}${gaps}`
}

// ------------------------------------------------------------
// Citation backstop
// ------------------------------------------------------------

// `|` is left out because the research separates several sources with it.
const URL_RE = /https?:\/\/[^\s<>()[\]"'`|]+/g
const trimUrl = (u: string) => u.replace(/[.,;:!?'"*_]+$/, '')

export function urlsIn(text: string): string[] {
  return (text.match(URL_RE) || []).map(trimUrl)
}

// Every URL the write-up was given: the pages behind each fact, plus any URL
// written into a fact itself.
export function researchUrls(r: GeminiWebResearch): string[] {
  return r.lanes.flatMap((l) =>
    l.facts.flatMap((f) => [...f.links.slice(0, MAX_LINKS_PER_FACT).map((x) => x.url), ...urlsIn(f.body)]),
  )
}

function urlKey(u: string): string {
  try {
    const x = new URL(u)
    return `${x.hostname.replace(/^www\./i, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`.toLowerCase()
  } catch {
    return u.toLowerCase()
  }
}

export function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./i, '')
  } catch {
    return 'source'
  }
}

const UNVERIFIED = '(unverified link removed)'

// The write-up may cite only the pages Google found (or the attached
// documents). A URL that isn't one of them came from Claude's memory, which
// the General Prompt forbids, so its link is removed and marked; a truncated
// copy of a listed URL is restored to the full one. Stray fact tags ([F3])
// are removed too.
export function enforceSourcedUrls(text: string, allowed: string[]): { text: string; removed: number; restored: number } {
  const byKey = new Map<string, string>()
  for (const u of allowed) byKey.set(urlKey(u), u)
  const keys = [...byKey.keys()]
  let removed = 0
  let restored = 0

  const resolve = (url: string): string | null => {
    const key = urlKey(url)
    if (byKey.has(key)) return url
    // Restored only when unambiguous: a short prefix such as a site's section
    // page could belong to several sources.
    const matches = key.length >= 20 ? keys.filter((k) => k.startsWith(key)) : []
    if (matches.length === 1) {
      restored += 1
      return byKey.get(matches[0])!
    }
    return null
  }

  let out = text
    .replace(/[ \t]*\[\s*F\d+(?:\s*[,;&]\s*F\d+)*\s*\](?!\()/g, '')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
      const ok = resolve(url)
      if (ok) return `[${label}](${ok})`
      removed += 1
      return `${/^https?:\/\//.test(label) ? hostOf(label) : label} ${UNVERIFIED}`
    })

  out = out.replace(/(\]\()?(https?:\/\/[^\s<>()[\]"'`|]+)/g, (m, inLink: string | undefined, raw: string) => {
    if (inLink) return m
    const url = trimUrl(raw)
    const tail = raw.slice(url.length)
    const ok = resolve(url)
    if (ok) return ok + tail
    removed += 1
    return `${hostOf(url)} ${UNVERIFIED}${tail}`
  })

  return { text: out, removed, restored }
}
