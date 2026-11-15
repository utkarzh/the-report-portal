// Sales Coach pattern analysis (13 Nov 2026): one Sales Executive's Report
// Cards read together — the last 5, 10, 20 or all of them — so an admin sees
// what keeps happening across negotiations, not just in one. Isomorphic: the
// page computes the same stats in the browser for its free snapshot, and the
// API route uses them (plus the digests and contract) for the AI call.
//
// The split mirrors the Report Card's: CODE owns which cards are read and
// every count and average (computePatternStats(), handed to the model as
// "MEASURED BY THE SYSTEM"); the MODEL only interprets — recurring strengths
// and gaps, the trend, objections, follow-through, a coaching plan — from the
// cards' own verdicts and evidence, never re-scoring them.
import {
  SALES_COACH_CRITERIA, commercialOutcomeType, formatOutcomeDetails, scoreBand, scorePercent,
} from '@/lib/sales-coach'
import type { SalesCoachOutcome, SalesCoachReportCard, SalesCoachVerdict } from '@/types'

export type PatternScope = '5' | '10' | '20' | 'all'

export const PATTERN_SCOPES: { id: PatternScope; label: string; limit: number | null }[] = [
  { id: '5', label: 'Last 5', limit: 5 },
  { id: '10', label: 'Last 10', limit: 10 },
  { id: '20', label: 'Last 20', limit: 20 },
  { id: 'all', label: 'All', limit: null },
]

// "All" reads at most this many, newest first. The most anyone has today is
// 32 (13 Nov 2026); at ~1k tokens per compact digest this stays far inside
// the model's context and the request's time limit.
export const PATTERN_MAX_CARDS = 60

export function isPatternScope(v: unknown): v is PatternScope {
  return PATTERN_SCOPES.some((s) => s.id === v)
}

// One Report Card as the pattern page lists it: identity, outcome, score and
// each criterion's verdict. No prompt text, so a whole history is light.
export interface PatternCardSummary {
  id: string
  created_at: string
  company: string | null
  country: string | null
  publication: string | null
  interviewee: string | null
  declared_outcome: SalesCoachOutcome | null
  pct: number | null
  headline: string
  verdicts: Record<string, SalesCoachVerdict>
}

// One entry in the page's executive dropdown.
export interface PatternExecutiveOption {
  id: string
  name: string
  email: string | null
  // Distinct meetings with a Report Card (a re-evaluated meeting counts once).
  cards: number
  lastAt: string
}

// One saved analysis in the history list.
export interface PatternAnalysisListItem {
  id: string
  scope: string
  card_count: number
  period_start: string | null
  period_end: string | null
  created_by_name: string | null
  created_at: string
}

// The negotiation row fields the pattern feature reads (server side).
export interface PatternNegotiationRow {
  id: string
  user_id: string | null
  created_at: string
  updated_at: string
  company: string | null
  country: string | null
  media_publication: string | null
  interviewee_name: string | null
  interviewee_position: string | null
  submitted_by_name: string | null
  declared_outcome: SalesCoachOutcome | null
  outcome_details: Record<string, unknown> | null
  report_card: SalesCoachReportCard
}

export const PATTERN_ROW_COLUMNS =
  'id, user_id, created_at, updated_at, company, country, media_publication, interviewee_name, interviewee_position, submitted_by_name, declared_outcome, outcome_details, report_card'

// A "Re-evaluate" copy keeps its original's created_at (and its owner), so one
// meeting is one created_at. Keep the newest card per meeting, so a meeting
// scored twice is read once, with the current coach's card. Works whether or
// not migration 036's reevaluated_from column exists. Newest meeting first.
export function latestCardPerMeeting<T extends { created_at: string; updated_at: string }>(rows: T[]): T[] {
  const byMeeting = new Map<string, T>()
  for (const r of rows) {
    const prev = byMeeting.get(r.created_at)
    if (!prev || r.updated_at > prev.updated_at) byMeeting.set(r.created_at, r)
  }
  return Array.from(byMeeting.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

// The cards a scope covers, from a newest-first list.
export function cardsForScope<T>(newestFirst: T[], scope: PatternScope): T[] {
  const limit = PATTERN_SCOPES.find((s) => s.id === scope)?.limit ?? null
  return newestFirst.slice(0, Math.min(limit ?? PATTERN_MAX_CARDS, PATTERN_MAX_CARDS))
}

// A scope is offered when the executive has enough cards to fill it ("All"
// always is). The page and the route use the same rule.
export function scopeAvailable(scope: PatternScope, available: number): boolean {
  const limit = PATTERN_SCOPES.find((s) => s.id === scope)?.limit ?? null
  return available > 0 && (limit === null || available >= limit)
}

export function toPatternSummary(r: PatternNegotiationRow): PatternCardSummary {
  const card = r.report_card
  const verdicts: Record<string, SalesCoachVerdict> = {}
  for (const c of card.criteria || []) verdicts[c.key] = c.verdict
  return {
    id: r.id,
    created_at: r.created_at,
    company: r.company || card.company || null,
    country: r.country,
    publication: r.media_publication,
    interviewee: [r.interviewee_name, r.interviewee_position].filter(Boolean).join(', ') || null,
    declared_outcome: r.declared_outcome ?? card.declared_outcome ?? null,
    pct: scorePercent(card.execution_score, card.execution_denominator),
    headline: card.headline || '',
    verdicts,
  }
}

// ── Stats (code-computed, never by the model) ────────────────────────────

export interface PatternCriterionStat {
  key: string
  label: string
  number: number
  pass: number
  warn: number
  fail: number
  na: number
  uv: number
  // Cards where this criterion was rated Strong, Partial or Weak.
  applicable: number
  // Share rated Strong among the applicable cards, 0-100.
  strongShare: number | null
  // Share of the available credit earned (Strong full, Partial half), 0-100 —
  // the criterion's own "score" across the cards.
  creditShare: number | null
  // creditShare in the older and the more recent half of the cards (each
  // half needs 2+ applicable cards), for movement.
  earlierCredit: number | null
  laterCredit: number | null
}

export interface PatternStats {
  count: number
  scoredCount: number
  periodStart: string | null
  periodEnd: string | null
  averagePct: number | null
  // Average score of the older and the more recent half of the scored cards
  // (chronological); null with fewer than 4 scored cards — too few to call.
  earlierAvg: number | null
  laterAvg: number | null
  outcomes: Record<SalesCoachOutcome | 'unknown', number>
  criteria: PatternCriterionStat[]
}

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

function creditOf(cards: PatternCardSummary[], key: string): { applicable: number; credit: number | null } {
  let pass = 0, warn = 0, fail = 0
  for (const c of cards) {
    const v = c.verdicts[key]
    if (v === 'pass') pass++
    else if (v === 'warn') warn++
    else if (v === 'fail') fail++
  }
  const applicable = pass + warn + fail
  return { applicable, credit: applicable ? Math.round(((pass + warn * 0.5) / applicable) * 100) : null }
}

export function computePatternStats(cards: PatternCardSummary[]): PatternStats {
  const chrono = [...cards].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  const scored = chrono.filter((c) => c.pct !== null).map((c) => c.pct as number)
  const half = Math.floor(scored.length / 2)
  const outcomes: PatternStats['outcomes'] = { signed: 0, retorno: 0, lost: 0, uncertain: 0, unknown: 0 }
  for (const c of cards) outcomes[c.declared_outcome ?? 'unknown']++

  const cardHalf = Math.floor(chrono.length / 2)
  const earlierCards = chrono.slice(0, cardHalf)
  const laterCards = chrono.slice(chrono.length - cardHalf)

  const criteria = SALES_COACH_CRITERIA.map(({ key, label, number }) => {
    const counts = { pass: 0, warn: 0, fail: 0, na: 0, uv: 0 }
    for (const c of cards) {
      const v = c.verdicts[key]
      if (v) counts[v]++
    }
    const applicable = counts.pass + counts.warn + counts.fail
    const earlier = creditOf(earlierCards, key)
    const later = creditOf(laterCards, key)
    return {
      key, label, number, ...counts, applicable,
      strongShare: applicable ? Math.round((counts.pass / applicable) * 100) : null,
      creditShare: creditOf(cards, key).credit,
      earlierCredit: earlier.applicable >= 2 ? earlier.credit : null,
      laterCredit: later.applicable >= 2 ? later.credit : null,
    }
  })

  return {
    count: cards.length,
    scoredCount: scored.length,
    periodStart: chrono[0]?.created_at ?? null,
    periodEnd: chrono[chrono.length - 1]?.created_at ?? null,
    averagePct: mean(scored),
    earlierAvg: scored.length >= 4 ? mean(scored.slice(0, half)) : null,
    laterAvg: scored.length >= 4 ? mean(scored.slice(scored.length - half)) : null,
    outcomes,
    criteria,
  }
}

// ── Prompt pieces ────────────────────────────────────────────────────────

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function clip(text: string | null | undefined, max: number): string {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))
  return `${(lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut).trim()}…`
}

const VERDICT_WORD: Record<SalesCoachVerdict, string> = {
  pass: 'Strong',
  warn: 'Partial',
  fail: 'Weak',
  na: 'N/A (not applicable)',
  uv: 'UV (could not be verified from the audio)',
}

// The counts the model must use rather than count itself.
export function patternStatsBlock(stats: PatternStats): string {
  const lines = [
    '--- MEASURED BY THE SYSTEM (use these numbers; never count or average anything yourself) ---',
    `Report Cards analysed: ${stats.count}${stats.periodStart && stats.periodEnd ? `, from ${shortDate(stats.periodStart)} to ${shortDate(stats.periodEnd)}` : ''}.`,
    `Report Cards with a calculable score: ${stats.scoredCount}.`,
    `Average Overall Execution Score: ${stats.averagePct === null ? 'not calculable' : `${stats.averagePct}%`}.`,
    stats.earlierAvg !== null && stats.laterAvg !== null
      ? `Trend: the older half of the scored cards averaged ${stats.earlierAvg}%, the more recent half ${stats.laterAvg}% (${stats.laterAvg - stats.earlierAvg >= 0 ? '+' : ''}${stats.laterAvg - stats.earlierAvg} points).`
      : 'Trend: too few scored cards (fewer than 4) to compare an older and a more recent half.',
    `Declared outcomes: ${(['signed', 'retorno', 'lost', 'uncertain'] as const).map((o) => `${commercialOutcomeType(o)} ${stats.outcomes[o]}${stats.count ? ` (${Math.round((stats.outcomes[o] / stats.count) * 100)}%)` : ''}`).join(', ')}${stats.outcomes.unknown ? `, not stated ${stats.outcomes.unknown}` : ''}.`,
    'Per criterion (Strong / Partial / Weak / N/A / UV; "credit" = share of the available credit earned across the cards where it applied, Strong full, Partial half):',
  ]
  for (const c of stats.criteria) {
    const movement = c.earlierCredit !== null && c.laterCredit !== null ? `; older half ${c.earlierCredit}% → recent half ${c.laterCredit}%` : ''
    lines.push(`- ${c.number}. ${c.label}: Strong ${c.pass}, Partial ${c.warn}, Weak ${c.fail}, N/A ${c.na}, UV ${c.uv}${c.creditShare !== null ? `; credit ${c.creditShare}%` : ''}${movement}`)
  }
  return lines.join('\n')
}

// One Report Card as the model reads it: its verdicts and the cards' own
// words, trimmed. `compact` (many cards) keeps the same fields, shorter.
export function patternCardDigest(r: PatternNegotiationRow, index: number, total: number, compact: boolean): string {
  const card = r.report_card
  const len = compact
    ? { summary: 320, reason: 210, reality: 150, better: 170, point: 170, handled: 150, trc: 150, deeper: 0, objections: 3 }
    : { summary: 650, reason: 380, reality: 240, better: 280, point: 280, handled: 240, trc: 240, deeper: 260, objections: 5 }
  const pct = scorePercent(card.execution_score, card.execution_denominator)
  const band = scoreBand(pct)
  const details = formatOutcomeDetails(r.declared_outcome, r.outcome_details).map((d) => `${d.label}: ${d.value}`).join('; ')
  const out: string[] = [
    `=== REPORT CARD ${index} of ${total} · ${shortDate(r.created_at)} · ${r.company || card.company || 'Company not given'} ===`,
    `Meeting: ${card.meeting || [r.interviewee_name, r.interviewee_position].filter(Boolean).join(', ') || '—'}`,
    `Country / publication: ${[r.country, r.media_publication].filter(Boolean).join(' / ') || '—'}`,
    `Declared outcome: ${commercialOutcomeType(r.declared_outcome ?? card.declared_outcome)}${details ? ` (${details})` : ''}`,
    `Overall Execution Score: ${pct === null ? 'not calculable' : `${pct}%${band ? ` (${band.label})` : ''}`}`,
    `Result: ${clip(card.headline, 260)}`,
    `Summary: ${clip(card.summary, len.summary)}`,
    'Criteria:',
  ]
  for (const c of card.criteria || []) {
    const meta = SALES_COACH_CRITERIA.find((k) => k.key === c.key)
    const parts = [`- ${meta ? `${meta.number}. ${meta.label}` : c.label}: ${VERDICT_WORD[c.verdict] || c.verdict}`]
    if (c.reason) parts.push(`— ${clip(c.reason, len.reason)}`)
    if (c.commercial_reality) parts.push(`| Commercial reality: ${clip(c.commercial_reality, len.reality)}`)
    if (c.better_approach) parts.push(`| Better approach: ${clip(c.better_approach, len.better)}`)
    out.push(parts.join(' '))
  }
  if (card.strengths?.length) out.push('What they did well:', ...card.strengths.map((p) => `- ${clip(p.title, 120)}: ${clip(p.detail, len.point)}`))
  if (card.improvements?.length) out.push('Areas for improvement:', ...card.improvements.map((p) => `- ${clip(p.title, 120)}: ${clip(p.detail, len.point)}`))
  if (card.objections?.length) {
    out.push('Objections:')
    for (const o of card.objections.slice(0, len.objections)) {
      out.push(`- "${clip(o.objection, 160)}" — handled: ${clip(o.handled, len.handled)}${o.trc_improved_response ? ` | TRC response: ${clip(o.trc_improved_response, len.trc)}` : ''}`)
    }
  }
  if (len.deeper && card.deeper_analysis?.length) {
    out.push('Deeper analysis:', ...card.deeper_analysis.slice(0, 3).map((s) => `- ${clip(s.heading, 80)}: ${clip(s.body, len.deeper)}`))
  }
  if (card.coaching_question) out.push(`Coaching question: ${clip(card.coaching_question, 240)}`)
  if (card.next_commercial_priority) out.push(`Next commercial priority: ${clip(card.next_commercial_priority, 240)}`)
  return out.join('\n')
}

export const PATTERN_ANALYST_PERSONA = `You are the TRC Sales Coach's senior analyst. TRC management has asked you to read ONE Sales Executive's Report Cards together and tell them what keeps happening across that person's negotiations: the habits that win, the gaps that keep costing deals, whether they are improving, and what to coach next. Each Report Card was produced by the TRC Sales Coach from a real negotiation with a CEO or senior official right after an editorial interview, under the TRC knowledge documents below.

Your doctrine is the TRC knowledge documents below, in this order of authority: the Sales Coach Project Prompt, the Manual (TRC Overcoming Objections), the TRC Sales Coaching Method, the Successful Negotiation Examples (pattern recognition only) and the Post-Meeting Follow-Up & Conversion Playbook. Every principle and every recommended wording must come from them; name the document when you use one.`

// Placed LAST in the system prompt, so it wins on structure.
export const PATTERN_ANALYSIS_CONTRACT = `PATTERN ANALYSIS — OUTPUT CONTRACT

You receive the executive's Report Cards (oldest first) and a MEASURED BY THE SYSTEM block. Write the pattern analysis for TRC management, in English, about the executive by first name, in the third person.

RULES
- Evidence only from these Report Cards. Never invent a negotiation, a quote, a figure or an outcome. When you give an example, cite it as (Company, D Mon), e.g. (Ordabasy Group, 14 Oct).
- Every count, share, average and trend figure comes from MEASURED BY THE SYSTEM, word for word. Never count, average or estimate anything yourself.
- A pattern needs at least two negotiations. Say how often it happened ("in 6 of 9 negotiations where it applied"). If only one Report Card is provided, say plainly that one negotiation can't show patterns, then describe what it shows.
- The cards' verdicts are the starting point: never re-score a criterion or contradict a card without saying why. UV means the audio couldn't verify it: never count a UV as a weakness.
- Scores are percentages only. Never show points such as "3.5/8".
- Judge execution, not luck: separate what the executive controlled from what the buyer decided, as the Project Prompt does.
- Doctrine and recommended wording come only from the TRC knowledge documents; name the document. If they are silent, say so.
- Plain, direct management prose. No motivational padding, no generic sales jargon.

FORMAT (Markdown). Start directly with the first heading — no title, no preamble, no horizontal rules (---). Use exactly these headings, in this order, and keep to each section's word budget: management reads this in five minutes, so choose the evidence that matters most rather than listing everything. Cite one or two examples per point, never a list of companies, and never restate the same figure twice.
## At a glance
At most 80 words: how many negotiations, over what period, the average score and its direction, and the single most important pattern.
## What they consistently do well
Two or three recurring strengths, each a bold lead-in plus at most 60 words: how often, one or two cited examples.
## Recurring gaps
Two to four recurring weaknesses, ranked by commercial cost, each a bold lead-in plus at most 70 words: how often, a cited example, what it cost, and the TRC rule it breaks (name the document).
## Is it improving?
At most 110 words. Read the trend from the measured figures, overall and for the two or three criteria that moved most. Say plainly when there are too few cards to tell.
## Objections that keep coming up
At most 130 words: the objections that recur, how they were handled, and the TRC wording to use next time (name the document). If none recur, say so in one sentence.
## Commercial follow-through
At most 120 words: the outcome mix, and how retornos are typically left — real buy-in or only interest, space and price on the table, decision-makers identified, the next meeting fixed or not — and what that means for conversion.
## Coaching plan
Exactly three numbered priorities, each at most 80 words: the behaviour to change, the exact TRC wording or drill to practise (name the document), and what a manager should look for in the next Report Cards.
## Notes on the evidence
One to three short bullets, at most 60 words in all: anything that limits these conclusions (few cards, UV criteria, older-format cards with less detail, outcomes the recordings couldn't show).`
