import type {
  SalesCoachKnowledgeKey,
  SalesCoachOutcome,
  SalesCoachReportCard,
  SalesCoachCriterion,
  SalesCoachVerdict,
  SalesCoachNegotiation,
  SalesCoachStage,
  SalesCoachEvidence,
  SalesCoachObjection,
  SalesCoachAnalysisSection,
  SalesCoachTranscriptSegment,
  SalesCoachCorrection,
  SalesCoachCoachingPrompt,
  SalesCoachCardPoint,
  SalesCoachTrack,
} from '@/types'

// Isomorphic helpers for the Sales Negotiation Coach module — safe to import
// from client components (no supabase/anthropic imports here). Server-only
// prompt assembly lives in sales-coach-context.ts.

export const SALES_COACH_AUDIO_BUCKET = 'sales-coach-audio'

// The four negotiation outcomes the Sales Executive declares (US-036).
export const SALES_COACH_OUTCOMES: { value: SalesCoachOutcome; label: string }[] = [
  { value: 'signed', label: 'Signed on the spot' },
  { value: 'retorno', label: 'Retorno' },
  { value: 'lost', label: 'Lost' },
  { value: 'uncertain', label: 'Uncertain' },
]

export function outcomeLabel(v: SalesCoachOutcome | null | undefined): string {
  return SALES_COACH_OUTCOMES.find((o) => o.value === v)?.label || 'Not declared'
}

// Workflow stages, with the labels shown on list cards and the detail header.
export const SALES_COACH_STAGE_LABELS: Record<SalesCoachStage, string> = {
  draft: 'Draft',
  transcribing: 'Transcribing',
  transcribed: 'Ready for Report Card',
  analyzing: 'Generating Report Card',
  complete: 'Report Card ready',
  failed: 'Needs attention',
}

// The five admin-managed knowledge documents, in their fixed authority order
// (US-038). Order matters: the array itself is the authority hierarchy used
// when assembling the AI context. The Follow-Up & Conversion Playbook (fifth,
// Oct 2026) governs post-meeting conversion coaching only — it is never used
// to score the recorded negotiation.
export const SALES_COACH_KNOWLEDGE_DOCS: {
  key: SalesCoachKnowledgeKey
  label: string
  description: string
}[] = [
  { key: 'project_prompt', label: 'Sales Coach Project Prompt', description: 'The main system instruction and highest-authority document. Governs how every Report Card is produced.' },
  { key: 'manual', label: 'Manual — TRC Overcoming Objections', description: 'Objection-handling doctrine and the planteo build-up formula referenced when offer build-up scores weak.' },
  { key: 'method', label: 'TRC Sales Coaching Method', description: 'The coaching method and evaluation approach.' },
  { key: 'examples', label: 'TRC Successful Negotiation Examples', description: 'Pattern-recognition reference only — its facts are never imported into another negotiation.' },
  { key: 'followup_playbook', label: 'TRC Post-Meeting Follow-Up & Conversion Playbook', description: 'How the coach helps convert retornos into signed contracts. Used for post-meeting coaching only, never for scoring the recorded negotiation.' },
]

export function isSalesCoachKnowledgeKey(v: unknown): v is SalesCoachKnowledgeKey {
  return SALES_COACH_KNOWLEDGE_DOCS.some((d) => d.key === v)
}

export function isSalesCoachOutcome(v: unknown): v is SalesCoachOutcome {
  return v === 'signed' || v === 'retorno' || v === 'lost' || v === 'uncertain'
}

// The eight SCORED Report Card criteria, in the fixed order of the Project
// Prompt's report format (US-039). `number` is that document's own section
// number — it deliberately skips 3, which is COMMERCIAL OUTCOME: the Project
// Prompt is explicit that section is "NOT SCORED" and "never included" in the
// denominator ("Do not automatically use eight as the denominator. Commercial
// Outcome is never included."), so it is not one of these criteria at all —
// see commercialOutcomeLabel()/commercialOutcomeNote() below for how it's
// rendered instead. `label` is the criterion name exactly as the client's
// sample Report Card writes it (Oct 2026), used in both the UI and the text.
export const SALES_COACH_CRITERIA: { key: string; label: string; number: number }[] = [
  { key: 'sales_offer_buildup', label: 'Sales Offer Buildup', number: 1 },
  { key: 'offer_articulation', label: 'Offer Articulation', number: 2 },
  { key: 'ceo_buyin', label: 'CEO Buy-In', number: 4 },
  { key: 'ceo_preference', label: 'CEO Preference', number: 5 },
  { key: 'space_price_retorno', label: 'Space and Price for Retorno', number: 6 },
  { key: 'space_price_agreement', label: 'Space and Price Agreement', number: 7 },
  { key: 'next_steps_stakeholders', label: 'Next Steps and Stakeholders', number: 8 },
  { key: 'scheduled_meeting', label: 'Scheduled Meeting', number: 9 },
]

const CRITERION_KEYS = SALES_COACH_CRITERIA.map((c) => c.key)
const VERDICTS: SalesCoachVerdict[] = ['pass', 'warn', 'fail', 'na', 'uv']

// Which criteria may be N/A, keyed to the declared outcome. Two tiers, both
// straight from the Project Prompt's own N/A wording:
//  - FORCED: the unconditional rules ("Use N/A if the outcome is Positive/Won
//    or Negative/Lost"; no further sales meeting after a signature or a
//    definitive loss). Applied in code whatever the model says.
//  - CONDITIONAL: N/A is allowed ONLY under the narrow condition the Prompt
//    names, and the model must say which in the note. Anything else is a
//    judgement (pass/warn/fail), never N/A.
// Until Oct 2026 Space and Price Agreement was forced N/A for a retorno: the
// old Prompt only gave ✅ for an agreed price, which a retorno can never
// have. The current Prompt scores the EXECUTION of seeking agreement ("a CEO
// refusal does not automatically prevent full execution credit") and names
// Space and Price Agreement among the criteria that rule applies to, so a
// retorno is now scored on all eight.
export const NA_BY_DECLARED_OUTCOME: Record<SalesCoachOutcome, string[]> = {
  signed: ['space_price_retorno', 'scheduled_meeting'],
  retorno: [],
  lost: ['space_price_retorno', 'scheduled_meeting'],
  uncertain: [],
}

export const CONDITIONAL_NA_BY_DECLARED_OUTCOME: Record<SalesCoachOutcome, { key: string; condition: string }[]> = {
  signed: [
    { key: 'next_steps_stakeholders', condition: 'the agreement was signed and no additional stakeholder involvement was required' },
  ],
  retorno: [
    { key: 'space_price_agreement', condition: 'no commercial offer was reached, for reasons outside your control' },
  ],
  lost: [
    { key: 'space_price_agreement', condition: 'no commercial offer was reached, for reasons outside your control' },
  ],
  uncertain: [
    { key: 'space_price_agreement', condition: 'no commercial offer was reached, for reasons outside your control' },
  ],
}

export function fixedNaCriteria(declared: SalesCoachOutcome | null | undefined): string[] {
  return declared ? NA_BY_DECLARED_OUTCOME[declared] : []
}

function conditionalNa(declared: SalesCoachOutcome | null | undefined): { key: string; condition: string }[] {
  return declared ? CONDITIONAL_NA_BY_DECLARED_OUTCOME[declared] : []
}

function criterionNumber(key: string): number {
  return SALES_COACH_CRITERIA.find((c) => c.key === key)?.number ?? 0
}

function criterionRef(key: string): string {
  const c = SALES_COACH_CRITERIA.find((c) => c.key === key)!
  return `${c.number}. ${c.label}`
}

// Per-run instruction appended to the submission so the model applies the
// table on the first pass (the validator enforces it regardless).
export function applicabilityInstruction(declared: SalesCoachOutcome | null | undefined): string {
  const na = fixedNaCriteria(declared)
  const cond = conditionalNa(declared)
  const label = outcomeLabel(declared)
  const naList = na.length ? na.map(criterionRef).join('; ') : 'none'
  const condLines = cond.length
    ? cond.map((c) => `- ${criterionRef(c.key)}: "na" ONLY if ${c.condition} — say so in the note. Otherwise score it.`).join('\n')
    : '- none'
  return `--- APPLICABLE CRITERIA (rule for a negotiation declared "${label}") ---
Always N/A: ${naList}. Give these the verdict "na" with a one-line note.
N/A only under a specific condition:
${condLines}
Every other criterion MUST receive pass, warn or fail with evidence — "na" is not allowed for them. Use "uv" only if a specific passage needed for that criterion is missing or unintelligible in the transcript.
Commercial Outcome (Section 3, the declared result) is not one of your criteria — the system renders it separately. Do not include it in criteria[].`
}

// Points per verdict. N/A and UV are excluded from the denominator entirely
// (US-041); a WARN is an execution gap that still earns half credit — this is
// what makes the sample card's "6/7 applicable points" add up (5 ✅ + 2 ⚠️).
export const VERDICT_POINTS: Record<SalesCoachVerdict, number | null> = {
  pass: 1,
  warn: 0.5,
  fail: 0,
  na: null,
  uv: null,
}

export function isScoredVerdict(v: SalesCoachVerdict): boolean {
  return VERDICT_POINTS[v] !== null
}

// Recompute the Execution Score in code rather than trusting the model
// (US-039). Returns the authoritative numbers.
export function recomputeScore(criteria: SalesCoachCriterion[]): { score: number; denominator: number } {
  let score = 0
  let denominator = 0
  for (const c of criteria) {
    const pts = VERDICT_POINTS[c.verdict]
    if (pts === null || pts === undefined) continue
    denominator += 1
    score += pts
  }
  return { score, denominator }
}

export function formatScore(score: number | null | undefined, denominator: number | null | undefined): string {
  if (typeof score !== 'number' || typeof denominator !== 'number' || !Number.isFinite(score)) return '—'
  const s = Number.isInteger(score) ? String(score) : score.toFixed(1)
  return `${s}/${denominator}`
}

// The Execution Score is shown to everyone — admins included — as a
// percentage ("79%") on lists and pills (9 Oct 2026, client request). The
// Report Card itself ends with the Project Prompt's own final scoreline,
// "79% (5.5/7 applicable points)" (Oct 2026 prompt) — see
// formatOverallScore(). Stored data — execution_score/denominator — stays in
// points; everything below is display only.
export function scorePercent(score: number | null | undefined, denominator: number | null | undefined): number | null {
  if (typeof score !== 'number' || typeof denominator !== 'number' || !Number.isFinite(score) || denominator <= 0) return null
  return Math.round((score / denominator) * 100)
}

export function formatScorePercent(score: number | null | undefined, denominator: number | null | undefined): string {
  const pct = scorePercent(score, denominator)
  return pct === null ? '—' : `${pct}%`
}

// A plain-language reading of the percentage, so a number on its own is never
// the whole message. Presentation only — the verdicts and the arithmetic stay
// the Project Prompt's and recomputeScore()'s; these bands only describe them.
export type ScoreBandTone = 'strong' | 'solid' | 'growth'
export interface ScoreBand {
  tone: ScoreBandTone
  label: string
  short: string
  hint: string
}

export function scoreBand(pct: number | null): ScoreBand | null {
  if (pct === null) return null
  if (pct >= 80) return { tone: 'strong', label: 'Strong execution', short: 'Strong', hint: 'Most of the TRC sequence landed. The details below are what separate this from a perfect call.' }
  if (pct >= 50) return { tone: 'solid', label: 'Good foundation, clear gaps', short: 'Good', hint: 'The core was there, but a few key steps were missed or only partly done. Fixing them is where the next deal is won.' }
  return { tone: 'growth', label: 'Room to grow', short: 'Room to grow', hint: 'Several key steps of the TRC sequence were missed. Start with the one below; it has the biggest impact on your next call.' }
}

// The steps that cost the most, biggest gain first: what fully meeting each
// would bring the percentage to. Uses the same per-verdict points as
// recomputeScore(), so the numbers always add up.
export interface ScoreOpportunity {
  key: string
  label: string
  verdict: 'warn' | 'fail'
  reachPct: number
}

export function scoreOpportunities(card: Pick<SalesCoachReportCard, 'criteria' | 'execution_score' | 'execution_denominator'>): ScoreOpportunity[] {
  const denom = card.execution_denominator
  if (!denom || denom <= 0) return []
  return card.criteria
    .filter((c): c is SalesCoachCriterion & { verdict: 'warn' | 'fail' } => c.scored && (c.verdict === 'fail' || c.verdict === 'warn'))
    .map((c) => ({
      key: c.key,
      label: SALES_COACH_CRITERIA.find((k) => k.key === c.key)?.label || c.label,
      verdict: c.verdict,
      reachPct: Math.round(((card.execution_score + (1 - (VERDICT_POINTS[c.verdict] ?? 0))) / denom) * 100),
    }))
    .sort((a, b) => b.reachPct - a.reachPct)
}

// The Project Prompt: "Never show a percentage without its applicable
// denominator when UV criteria exist." Pills on list views pass this as their
// `detail` so a UV-reduced percentage always carries its points ("4/5 · 1 UV").
export function scoreUvDetail(
  score: number | null | undefined,
  denominator: number | null | undefined,
  uvCount: number,
): string | undefined {
  return uvCount > 0 ? `${formatScore(score, denominator)} · ${uvCount} UV` : undefined
}

// Steps that couldn't be checked from the recording, in plain words. Keeps
// the Project Prompt's intent ("never display X/Y alone when UV criteria
// exist") now that the score is a percentage: say plainly that something
// wasn't counted, rather than letting a high or low % stand unexplained.
export function unverifiedNote(criteria: SalesCoachCriterion[]): string | null {
  const uv = criteria.filter((c) => c.verdict === 'uv').length
  if (uv === 0) return null
  return uv === 1
    ? "1 step couldn't be verified from the audio, so it isn't counted for or against you."
    : `${uv} steps couldn't be verified from the audio, so they aren't counted for or against you.`
}

// The final scoreline of the Report Card, exactly as the Project Prompt
// specifies: "Overall Execution Score: 79% (5.5/7 applicable points)", with
// the UV/N-A evidence coverage appended when anything was unverifiable, and
// "NOT CALCULABLE" (never an invented 0% or 100%) when nothing could be scored.
export function formatOverallScore(card: Pick<SalesCoachReportCard, 'criteria' | 'execution_score' | 'execution_denominator'>): string {
  const pct = scorePercent(card.execution_score, card.execution_denominator)
  if (pct === null) return 'NOT CALCULABLE (0 applicable verified criteria)'
  return `${pct}% (${formatScore(card.execution_score, card.execution_denominator)} applicable points)${scoreCoverageSuffix(card.criteria)}`
}

// Rewrites the scoreline phrases in a stored report_card_markdown into the
// current "79% (5.5/7 applicable points)" form. Rewritten rather than
// re-rendered because older cards were stored in earlier layouts ("1.5/6
// applicable points", "5.5/7 scored criteria", a Commercial Outcome
// criterion) that the current renderer would not reproduce. Skips a phrase
// already preceded by its percentage (the current renderer's own output), and
// only matches the phrases our own renderer writes, never model prose.
export function scoreTextAsPercent(markdown: string): string {
  return markdown.replace(
    /(?<!% \()(?<![\d.])(\d+(?:\.\d+)?)\s?\/\s?(\d+) (?:scored criteria|applicable points)((?: — \d+ UV, \d+ N\/A)?)/g,
    (match, s: string, d: string, coverage: string) => {
      const pct = formatScorePercent(Number(s), Number(d))
      if (pct === '—') return match
      return `${pct} (${formatScore(Number(s), Number(d))} applicable points)${coverage}`
    },
  )
}

// The Project Prompt's coverage convention: "Never display X/Y alone when UV
// criteria exist" — append the UV/N-A counts so a low denominator caused by
// unverifiable audio is never mistaken for a low score. Plain "X/Y" when there
// is no UV.
export function scoreCoverageSuffix(criteria: SalesCoachCriterion[]): string {
  const uv = criteria.filter((c) => c.verdict === 'uv').length
  if (uv === 0) return ''
  const na = criteria.filter((c) => c.verdict === 'na').length
  return ` — ${uv} UV, ${na} N/A`
}

export function verdictMark(v: SalesCoachVerdict): string {
  switch (v) {
    case 'pass': return '✅'
    case 'warn': return '⚠️'
    case 'fail': return '❌'
    case 'na': return 'N/A'
    case 'uv': return 'UV'
  }
}

// The rating words and points of the client's sample card: "Strong (1)",
// "Partial (0.5)", "Weak (0)". N/A and UV carry no points.
export const VERDICT_RATING: Record<SalesCoachVerdict, string> = {
  pass: 'Strong (1)',
  warn: 'Partial (0.5)',
  fail: 'Weak (0)',
  na: 'N/A — not scored',
  uv: 'UV — Audio verification required',
}

// "✅ Strong (1)" — the rating as it follows a criterion's name.
export function verdictRating(v: SalesCoachVerdict): string {
  return v === 'na' || v === 'uv' ? VERDICT_RATING[v] : `${verdictMark(v)} ${VERDICT_RATING[v]}`
}

// ────────────────────────────────────────────────────────────────────────────
// Coaching-tab personalization — opening prompts drawn from THIS negotiation's
// own Report Card, grouped into the Project Prompt's two coaching tracks:
// MEETING EXECUTION (practise the most important improvement from the
// recording) and NEXT COMMERCIAL ACTION (what to do with this opportunity
// now). Both are offered for every outcome; their commercial content follows
// the declared outcome.
// ────────────────────────────────────────────────────────────────────────────

export const SALES_COACH_TRACKS: Record<SalesCoachTrack, { label: string; hint: string }> = {
  execution: { label: 'Meeting execution', hint: 'Practise the most important improvement from this meeting.' },
  commercial: { label: 'Next commercial action', hint: 'Decide what to do with this opportunity now.' },
}

export function coachGreeting(card: SalesCoachReportCard, company: string | null): string {
  const read = `I've read your Report Card${company ? ` for ${company}` : ''}, the full transcript and the TRC knowledge documents.`
  const invitation = (card.coaching_invitation || '').trim()
  return invitation
    ? `${read} ${invitation} You can switch between the two at any time.`
    : `${read} We can practise the meeting itself, or work on the next commercial action for this opportunity. Pick either, and switch whenever you like:`
}

// The single prompt that opens (or switches to) the commercial track, worded
// for the declared outcome and, when the card named one, its grounded
// immediate priority. The Project Prompt: retorno → convert towards
// signature; won → contract/implementation coordination only where relevant;
// lost → a recovery route only if new evidence supports one, otherwise lessons.
function commercialTrackPrompt(card: SalesCoachReportCard): SalesCoachCoachingPrompt {
  const priority = (card.next_commercial_priority || '').trim()
  const withPriority = priority ? ` The Report Card named the immediate priority as: "${priority}"` : ''
  switch (card.declared_outcome) {
    case 'retorno':
      return { track: 'commercial', label: 'Plan how to convert this retorno', prompt: `Let's work on converting this retorno into a signed contract.${withPriority} What should I do next, and when?` }
    case 'signed':
      return { track: 'commercial', label: 'Anything to coordinate after signature?', prompt: `The deal is signed. Is there anything in the contract or implementation I should coordinate now?${withPriority}` }
    case 'lost':
      return { track: 'commercial', label: 'Is there a credible way back?', prompt: `This one was lost. Is there a credible route to recover it, or what should I take from it for future negotiations?${withPriority}` }
    default:
      return { track: 'commercial', label: 'Decide the next commercial action', prompt: `Help me decide the next commercial action for this opportunity.${withPriority}` }
  }
}

// The two prompts behind the always-visible "switch track" control in the
// coaching chat — one per track, so neither has to be finished first.
export function coachingTrackSwitches(card: SalesCoachReportCard): Record<SalesCoachTrack, SalesCoachCoachingPrompt> {
  return {
    execution: {
      track: 'execution',
      label: SALES_COACH_TRACKS.execution.label,
      prompt: 'Let\'s work on the meeting itself. Help me practise the most important improvement from this negotiation.',
    },
    commercial: { ...commercialTrackPrompt(card), label: SALES_COACH_TRACKS.commercial.label },
  }
}

// Execution track: the card's own reflective question first, then the
// weakest scored criteria (fail before warn; the model's verdicts, not
// re-judged here). Commercial track: the outcome-specific opener, plus a
// practical draft for a retorno. Falls back to a generic execution prompt
// when nothing scored below pass.
export function suggestedCoachingPrompts(card: SalesCoachReportCard): SalesCoachCoachingPrompt[] {
  const execution: SalesCoachCoachingPrompt[] = []
  if (card.coaching_question) {
    execution.push({ track: 'execution', label: 'Your coach’s question', prompt: card.coaching_question })
  }
  const weight = (v: SalesCoachVerdict) => (v === 'fail' ? 0 : v === 'warn' ? 1 : 2)
  const weak = card.criteria
    .filter((c) => c.scored && (c.verdict === 'fail' || c.verdict === 'warn'))
    .sort((a, b) => weight(a.verdict) - weight(b.verdict))
  for (const c of weak.slice(0, 2)) {
    const meta = SALES_COACH_CRITERIA.find((k) => k.key === c.key)
    const label = meta?.label || c.label
    execution.push({
      track: 'execution',
      label: `Practise your ${label}`,
      prompt: `I scored ${verdictMark(c.verdict)} on ${label}. Show me what I should have said, then let's rehearse that moment.`,
    })
  }
  if (execution.length < 2) {
    execution.push({ track: 'execution', label: 'What matters most for next time?', prompt: 'If I could only fix one thing before my next negotiation, what should it be and why?' })
  }

  const commercial: SalesCoachCoachingPrompt[] = [commercialTrackPrompt(card)]
  if (card.declared_outcome === 'retorno' || card.declared_outcome === 'uncertain') {
    commercial.push({ track: 'commercial', label: 'Draft a follow-up to the CEO', prompt: 'Draft a short follow-up message to the CEO for this opportunity, based on what was actually agreed in the meeting.' })
  }

  return [...execution.slice(0, 3), ...commercial]
}

// The outcome-conditional details captured on the form (US-036), turned into
// label/value rows for the detail page and for the AI context. Keys mirror
// SalesCoachForm's `details` state.
export function formatOutcomeDetails(
  outcome: SalesCoachOutcome | null | undefined,
  details: Record<string, unknown> | null | undefined,
): { label: string; value: string }[] {
  const d = details || {}
  const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string).trim() : '')
  const b = (k: string) => d[k] === true
  const money = (price: string, cur: string) => [price, cur ? cur.toUpperCase() : ''].filter(Boolean).join(' ')
  const rows: { label: string; value: string }[] = []

  if (outcome === 'signed') {
    rows.push({ label: 'Space / product signed', value: s('space') || '—' })
    rows.push({ label: 'Price', value: money(s('price'), s('currency')) || '—' })
  } else if (outcome === 'retorno') {
    if (b('noneEstablished')) {
      rows.push({ label: 'Space & price', value: 'No specific space and price were established' })
    } else {
      const opt1 = [s('opt1Space'), money(s('opt1Price'), s('opt1Currency'))].filter(Boolean).join(' · ')
      const opt2 = [s('opt2Space'), money(s('opt2Price'), s('opt2Currency'))].filter(Boolean).join(' · ')
      if (opt1) rows.push({ label: 'Option 1', value: opt1 })
      if (opt2) rows.push({ label: 'Option 2', value: opt2 })
      if (!opt1 && !opt2) rows.push({ label: 'Space & price', value: 'No options recorded' })
    }
    const dm = [s('nextDmName'), s('nextDmPosition')].filter(Boolean).join(' — ')
    if (dm) rows.push({ label: 'Next decision-maker / signatory', value: dm })
    rows.push({ label: 'CEO introduced or contacted them', value: b('ceoIntroduced') ? 'Yes' : 'No' })
    rows.push({ label: 'Further decision meeting agreed', value: b('meetingAgreed') ? 'Yes' : 'No' })
    const when = [s('meetingDate'), s('meetingTime')].filter(Boolean).join(' at ')
    if (when) rows.push({ label: 'Meeting scheduled', value: when })
  } else if (outcome === 'lost') {
    rows.push({ label: 'Reason given by the client', value: s('lostReason') || 'Not recorded' })
  }
  return rows
}

// Facts and feedback the Sales Executive has given after reviewing a
// previous Report Card — either scoped to one criterion/the Commercial
// Outcome (a misheard number, a fact that happened off the recording) or
// general, card-wide feedback not tied to any one section — see
// 029_sales_coach_corrections.sql. Every entry ever submitted for a
// negotiation is folded into every future analyze call (not just the one
// that prompted it), so once given, it stays in effect. Returns '' when
// there are none so callers can splice it in unconditionally.
export function formatCorrectionsBlock(corrections: SalesCoachCorrection[]): string {
  if (corrections.length === 0) return ''
  const lines = [
    '--- CONFIRMED CORRECTIONS & FEEDBACK FROM THE SALES EXECUTIVE ---',
    'The Sales Executive has reviewed a previous Report Card and provided the following. Where it corrects a specific fact, treat it as ground truth: do not re-flag the original AI reading as unverifiable (uv) or as a discrepancy, and score/reason using the corrected fact. Where it is general feedback, weigh it as context from the person who ran the negotiation.',
  ]
  corrections.forEach((c, i) => {
    const meta = c.criterion_key ? SALES_COACH_CRITERIA.find((k) => k.key === c.criterion_key) : null
    const label = meta?.label || c.field_label || 'Commercial Outcome'
    const aiRead = c.ai_said ? ` AI read: "${c.ai_said}" —` : ''
    lines.push(`${i + 1}. [${label}]${aiRead} ${c.correction}`)
  })
  return lines.join('\n')
}

// Section 3, COMMERCIAL OUTCOME — NOT SCORED (Project Prompt). A factual
// label, built deterministically from the declared outcome, never awarded
// execution points and never asked of the model. The exact wording mirrors
// the Project Prompt's own labels: "POSITIVE / WON", "NEGATIVE / LOST",
// "FOLLOW-UP / RETORNO — [SPACE] at [PRICE]" (or "— OPEN, NO SPACE AGREED
// UPON" when nothing was established). The Project Prompt's fourth metadata
// option, "Uncertain", has no defined mapping in its own report format, so it
// is shown as declared rather than invented.
export function commercialOutcomeLabel(
  declared: SalesCoachOutcome | null | undefined,
  details: Record<string, unknown> | null | undefined,
): string {
  if (declared === 'signed' || declared === 'lost' || declared === 'uncertain' || !declared) return commercialOutcomeType(declared)
  if (declared === 'retorno') {
    const d = details || {}
    if (d.noneEstablished === true) return 'FOLLOW-UP / RETORNO — OPEN, NO SPACE AGREED UPON'
    const opt1 = formatOutcomeDetails(declared, details).find((r) => r.label === 'Option 1')?.value
    return opt1 ? `FOLLOW-UP / RETORNO — ${opt1}` : 'FOLLOW-UP / RETORNO — OPEN, NO SPACE AGREED UPON'
  }
  return commercialOutcomeType(declared)
}

// The bare outcome status — the sample card's "Outcome:" header line and the
// label that opens "A. Negotiation Result" ("FOLLOW-UP / RETORNO — …").
export function commercialOutcomeType(declared: SalesCoachOutcome | null | undefined): string {
  switch (declared) {
    case 'signed': return 'POSITIVE / WON'
    case 'retorno': return 'FOLLOW-UP / RETORNO'
    case 'lost': return 'NEGATIVE / LOST'
    case 'uncertain': return 'UNCERTAIN'
    default: return 'NOT DECLARED'
  }
}

// The sample card's "Meeting:" header line: "CEO Planteo", plus who it was
// with when the submission names them.
export function meetingLabel(interviewee: string | null | undefined): string {
  const who = (interviewee || '').trim()
  return who ? `CEO Planteo — ${who}` : 'CEO Planteo'
}

// The model sometimes repeats the outcome label the system already prints
// ("FOLLOW-UP / RETORNO — Half page…", "Retorno. Half page…"); drop it so the
// rendered line never reads "RETORNO — RETORNO — …".
const LEADING_OUTCOME = /^(?:apparent\s+)?(?:positive\s*\/\s*won|follow-up\s*\/\s*retorno|negative\s*\/\s*lost|signed on the spot|retorno|lost|uncertain)\b\s*[.:—–-]\s*/i
function stripLeadingOutcome(text: string): string {
  const stripped = text.replace(LEADING_OUTCOME, '').trim()
  return stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : text
}

// The factual detail line under the Commercial Outcome label — what the
// Sales Executive entered on the form, not a transcript-derived judgement.
export function commercialOutcomeNote(
  declared: SalesCoachOutcome | null | undefined,
  details: Record<string, unknown> | null | undefined,
): string {
  if (declared === 'signed') {
    const text = formatOutcomeDetails(declared, details).map((r) => r.value).filter((v) => v && v !== '—').join(', ')
    return text || 'Signed on the spot, as declared by the Sales Executive.'
  }
  if (declared === 'lost') {
    const reason = formatOutcomeDetails(declared, details).find((r) => r.label === 'Reason given by the client')?.value
    return reason && reason !== 'Not recorded' ? `Reason given by the client: ${reason}` : 'Declared lost by the Sales Executive.'
  }
  if (declared === 'retorno') return 'Follow-up required, as declared by the Sales Executive.'
  if (declared === 'uncertain') return 'Declared uncertain by the Sales Executive.'
  return 'No outcome was declared.'
}

// The transcript the analysis and coaching run on. A system transcript
// (AssemblyAI, speaker-labelled) wins over an uploaded one when both exist.
export function pickTranscript(
  n: Pick<SalesCoachNegotiation, 'system_transcript' | 'uploaded_transcript'>,
): { text: string; source: 'system' | 'uploaded' } | null {
  const sys = (n.system_transcript || '').trim()
  if (sys) return { text: sys, source: 'system' }
  const up = (n.uploaded_transcript || '').trim()
  if (up) return { text: up, source: 'uploaded' }
  return null
}

// ────────────────────────────────────────────────────────────────────────────
// Clickable transcript timestamps
// ────────────────────────────────────────────────────────────────────────────

// mm:ss (or h:mm:ss past the hour) for a millisecond offset.
export function formatTimestamp(ms: number): string {
  const totalSecs = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return (h > 0 ? `${h}:${mm}` : mm) + ':' + String(s).padStart(2, '0')
}

// Strip quote marks/punctuation and collapse whitespace so a model-written
// quote can be compared against the raw AssemblyAI text underneath it — the
// two are rarely byte-identical (smart quotes, an ellipsis the model added,
// a trailing gloss in brackets).
function normalizeForMatch(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ') // drop bracketed glosses, e.g. "[translated]"
    .replace(/[""'']/g, '"')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Finds the earliest transcript segment that contains a distinctive slice of
// `quote`. Uses the first ~8 words (falling back to fewer) as the search key —
// long enough to be distinctive, short enough to survive the model dropping a
// clause or adding "...". Returns undefined rather than guessing when nothing
// matches, so an evidence line simply has no clickable time instead of a wrong one.
export function matchEvidenceTimestamp(
  quote: string,
  segments: SalesCoachTranscriptSegment[] | null | undefined,
): number | undefined {
  if (!segments || segments.length === 0) return undefined
  const words = normalizeForMatch(quote).split(' ').filter(Boolean)
  if (words.length === 0) return undefined

  for (const keyLen of [8, 6, 4]) {
    if (words.length < keyLen) continue
    const key = words.slice(0, keyLen).join(' ')
    for (const seg of segments) {
      if (normalizeForMatch(seg.text).includes(key)) return seg.start_ms
    }
  }
  return undefined
}

// Attaches a `time_ms` to every evidence line the transcript can confirm.
// Never mutates; a card with no segments (pasted transcript, or transcribed
// before this feature) comes back unchanged.
export function attachEvidenceTimestamps(
  card: SalesCoachReportCard,
  segments: SalesCoachTranscriptSegment[] | null | undefined,
): SalesCoachReportCard {
  if (!segments || segments.length === 0) return card
  return {
    ...card,
    criteria: card.criteria.map((c) => ({
      ...c,
      evidence: c.evidence?.map((e) => {
        const time_ms = matchEvidenceTimestamp(e.text, segments)
        return time_ms === undefined ? e : { ...e, time_ms }
      }),
    })),
  }
}

// "Ordabasy Group Planteo.m4a" -> "Ordabasy Group Planteo". Used ONLY when the
// Sales Executive left the Company field blank (US-034/US-035 filename rule) —
// the typed field always wins. Per the Project Prompt, removes only obvious
// technical additions — the extension, "raw"/"formatted", duplicate numbering
// ("(1)", "copy 2") and upload suffixes (date/time stamps, long digit runs) —
// and keeps the company name as written. A recorder's default name
// ("WhatsApp Audio …", "New Recording 3") is not a company: null, so the card
// says "Unclear from filename" instead of inventing one.
const GENERIC_RECORDING_NAME = /^(?:whatsapp (?:audio|ptt)|new recording|voice memo|voice recording|recording|audio|untitled|record|rec|ptt|aud)(?: \d+)?$/i

export function deriveCompanyFromFilename(filename: string | null | undefined): string | null {
  if (!filename) return null
  const cleaned = filename
    .replace(/\.[a-z0-9]{2,5}$/i, '') // extension
    .replace(/[_\-.]+/g, ' ')
    .replace(/[([]\s*\d{1,3}\s*[)\]]/g, ' ') // duplicate numbering: "(1)", "[2]"
    .replace(/\bcopy(?:\s+\d{1,3})?\b/gi, ' ') // "copy", "copy 2"
    .replace(/\b(?:raw|formatted|uploaded|upload)\b/gi, ' ')
    .replace(/\b\d{4} \d{2} \d{2}(?: (?:at )?\d{1,2} \d{2}(?: \d{2})?)?\b/g, ' ') // 2026-10-13 [at] 10.32.11
    .replace(/\b\d{8,}\b/g, ' ') // 20261013, unix timestamps
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || GENERIC_RECORDING_NAME.test(cleaned)) return null
  return cleaned
}

// ────────────────────────────────────────────────────────────────────────────
// Report Card validation (US-039)
// ────────────────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function cleanEvidence(v: unknown): SalesCoachEvidence[] {
  if (!Array.isArray(v)) return []
  return v
    .map((e) => ({ label: str((e as { label?: unknown })?.label), text: str((e as { text?: unknown })?.text) }))
    .filter((e) => e.text)
    .map((e) => ({ label: e.label || 'Quote', text: e.text }))
}

function cleanObjections(v: unknown): SalesCoachObjection[] {
  if (!Array.isArray(v)) return []
  return v
    .map((o) => {
      const r = (o ?? {}) as Record<string, unknown>
      return {
        objection: str(r.objection),
        handled: str(r.handled),
        original_wording: str(r.original_wording) || undefined,
        trc_improved_response: str(r.trc_improved_response) || undefined,
        principle: str(r.principle) || undefined,
      }
    })
    .filter((o) => o.objection || o.handled)
}

function cleanSections(v: unknown): SalesCoachAnalysisSection[] {
  if (!Array.isArray(v)) return []
  return v
    .map((s) => ({ heading: str((s as { heading?: unknown })?.heading), body: str((s as { body?: unknown })?.body) }))
    .filter((s) => s.body)
    .map((s) => ({ heading: (s.heading || 'Further analysis').toUpperCase(), body: s.body }))
}

// Strengths (B) / areas for improvement (C): "two or three … If fewer are
// supported, give fewer" — so 0-3, truncated rather than rejected.
function cleanPoints(v: unknown): SalesCoachCardPoint[] {
  if (!Array.isArray(v)) return []
  return v
    .map((p) => ({ title: str((p as { title?: unknown })?.title), detail: str((p as { detail?: unknown })?.detail) }))
    .filter((p) => p.title || p.detail)
    .slice(0, 3)
}

// Structural validation of the model's Report Card. We do NOT trust the model's
// arithmetic or completeness — this checks every criterion is present exactly
// once with a valid verdict, the required prose fields are filled, and exactly
// one coaching question exists; then it normalises the object (fixed criterion
// order, labels, `scored` flags) and recomputes the score. Returns the list of
// problems (empty = valid) so the route can trigger one corrective pass.
export function validateReportCard(
  rc: unknown,
  ctx: { company: string; declaredOutcome: SalesCoachOutcome | null; outcomeDetails?: Record<string, unknown> | null; meeting?: string | null },
): { ok: boolean; problems: string[]; normalized?: SalesCoachReportCard } {
  const problems: string[] = []
  if (!rc || typeof rc !== 'object' || Array.isArray(rc)) {
    return { ok: false, problems: ['Report card is not a JSON object'] }
  }
  const card = rc as Record<string, unknown>

  if (!str(card.headline)) problems.push('Missing headline')
  if (!str(card.summary)) problems.push('Missing summary')
  if (!str(card.commercial_outcome_summary)) problems.push('Missing commercial_outcome_summary (Section 3 detail)')
  if (!Array.isArray(card.strengths)) problems.push('Missing strengths array')
  if (!Array.isArray(card.improvements)) problems.push('Missing improvements array')
  if (!str(card.coaching_question)) problems.push('Missing the single coaching question')
  if (!str(card.coaching_invitation)) problems.push('Missing the two-track coaching invitation')

  const rawCriteria = Array.isArray(card.criteria) ? (card.criteria as Record<string, unknown>[]) : []
  if (rawCriteria.length === 0) problems.push('Missing criteria array')

  const byKey = new Map<string, Record<string, unknown>>()
  for (const c of rawCriteria) {
    const key = str(c?.key)
    if (!CRITERION_KEYS.includes(key)) {
      problems.push(`Unknown criterion key: ${key || '(empty)'}`)
      continue
    }
    if (byKey.has(key)) problems.push(`Duplicate criterion: ${key}`)
    byKey.set(key, c)
  }
  const fixedNa = new Set(fixedNaCriteria(ctx.declaredOutcome))
  const allowedNa = new Set([...fixedNa, ...conditionalNa(ctx.declaredOutcome).map((c) => c.key)])
  for (const { key, label } of SALES_COACH_CRITERIA) {
    const c = byKey.get(key)
    if (!c) {
      problems.push(`Missing criterion: ${label}`)
      continue
    }
    const verdict = str(c.verdict)
    if (!VERDICTS.includes(verdict as SalesCoachVerdict)) {
      problems.push(`Criterion ${label}: verdict must be one of ${VERDICTS.join('/')}`)
      continue
    }
    // Applicability follows NA_BY_DECLARED_OUTCOME / the conditional table: a
    // model "na" outside them is a missing judgement, not a valid verdict, and
    // a conditional N/A must say why it applies.
    if (verdict === 'na' && !allowedNa.has(key) && ctx.declaredOutcome) {
      problems.push(`Criterion ${label} cannot be N/A for a negotiation declared "${outcomeLabel(ctx.declaredOutcome)}" — give pass, warn or fail with evidence`)
    }
    if (verdict === 'na' && allowedNa.has(key) && !fixedNa.has(key) && !str(c.note) && !str(c.reason)) {
      problems.push(`Criterion ${label}: an N/A here needs a note explaining why the Project Prompt's N/A condition applies`)
    }
    if (!str(c.reason) && !str(c.note) && !fixedNa.has(key)) {
      problems.push(`Criterion ${label}: needs a reason`)
    }
  }

  if (problems.length > 0) return { ok: false, problems }

  const criteria: SalesCoachCriterion[] = SALES_COACH_CRITERIA.map(({ key, label }) => {
    const c = byKey.get(key)!
    const forcedNa = fixedNa.has(key)
    const verdict = forcedNa ? 'na' : (str(c.verdict) as SalesCoachVerdict)
    return {
      key,
      label,
      verdict,
      note: str(c.note) || (forcedNa ? `not applicable when the outcome is ${outcomeLabel(ctx.declaredOutcome)}` : undefined),
      evidence: forcedNa ? [] : cleanEvidence(c.evidence),
      reason: forcedNa ? undefined : (str(c.reason) || undefined),
      commercial_reality: verdict === 'na' ? undefined : (str(c.commercial_reality) || undefined),
      better_approach: verdict === 'na' || verdict === 'pass' ? undefined : (str(c.better_approach) || undefined),
      scored: isScoredVerdict(verdict),
    }
  })

  const { score, denominator } = recomputeScore(criteria)

  const normalized: SalesCoachReportCard = {
    company: ctx.company,
    declared_outcome: ctx.declaredOutcome,
    commercial_outcome_label: commercialOutcomeLabel(ctx.declaredOutcome, ctx.outcomeDetails),
    commercial_outcome_note: commercialOutcomeNote(ctx.declaredOutcome, ctx.outcomeDetails),
    commercial_outcome_summary: stripLeadingOutcome(str(card.commercial_outcome_summary)),
    meeting: ctx.meeting || meetingLabel(null),
    headline: stripLeadingOutcome(str(card.headline)),
    execution_score: score,
    execution_denominator: denominator,
    summary: str(card.summary),
    strengths: cleanPoints(card.strengths),
    improvements: cleanPoints(card.improvements),
    criteria,
    objections: cleanObjections(card.objections),
    deeper_analysis: cleanSections(card.deeper_analysis),
    coaching_question: str(card.coaching_question),
    coaching_invitation: str(card.coaching_invitation),
    next_commercial_priority: str(card.next_commercial_priority) || undefined,
  }
  return { ok: true, problems: [], normalized }
}

// ────────────────────────────────────────────────────────────────────────────
// Text rendering — the client's sample Report Card (Oct 2026), line for line:
//   TRC SALES COACH — REPORT CARD / Company / Meeting / Outcome
//   A. Negotiation Result → B. What You Did Well → C. Main Areas for
//   Improvement → D. Detailed Performance Assessment ("1. Sales Offer Buildup
//   — ✅ Strong (1)" + Evidence / Assessment / Commercial reality / Better
//   approach; 3 = Commercial Outcome — NOT SCORED) → E. Deeper Coaching
//   (ending with the one reflective question and the two-track invitation)
//   → F. Overall Execution Score, LAST.
// Derived from the structured card so the text and the UI can never disagree.
// Cards from before this layout (no strengths/improvements) skip B and C
// rather than printing them empty.
// ────────────────────────────────────────────────────────────────────────────

// A meaningful evidence label ("Your question", "CEO's response") is kept;
// generic ones ("Quote", "Evidence") are dropped since the line already says
// "Evidence".
export function evidenceLabel(label: string | undefined): string {
  const l = (label || '').trim()
  return !l || /^(quote|quoted|evidence)$/i.test(l) ? '' : l
}

export function renderReportCardMarkdown(card: SalesCoachReportCard): string {
  const lines: string[] = []
  const hasNewLayout = Array.isArray(card.strengths)
  const outcomeType = commercialOutcomeType(card.declared_outcome)

  lines.push('# TRC SALES COACH — REPORT CARD')
  lines.push(`**Company:** ${card.company || 'Unclear from filename'}  `)
  lines.push(`**Meeting:** ${card.meeting || meetingLabel(null)}  `)
  lines.push(`**Outcome:** ${outcomeType}`)
  lines.push('')

  lines.push('## A. Negotiation Result')
  lines.push(hasNewLayout ? `**${outcomeType} — ${card.headline}**` : `**${card.commercial_outcome_label}**`)
  if (!hasNewLayout) lines.push(card.headline)
  lines.push('')
  lines.push(card.summary)
  if (!hasNewLayout && card.report_summary) {
    lines.push('')
    lines.push(card.report_summary)
  }
  lines.push('')

  const points = (heading: string, items: SalesCoachCardPoint[] | undefined, empty: string) => {
    lines.push(`## ${heading}`)
    if (!items || items.length === 0) lines.push(empty)
    else items.forEach((p, i) => lines.push(`${i + 1}. **${p.title.replace(/\.$/, '')}.** ${p.detail}`))
    lines.push('')
  }
  if (hasNewLayout) {
    points('B. What You Did Well', card.strengths, 'No strengths could be grounded in the transcript evidence.')
    points('C. Main Areas for Improvement', card.improvements, 'No material controllable improvements were identified.')
  }

  lines.push('## D. Detailed Performance Assessment')
  card.criteria.forEach((c, i) => {
    const meta = SALES_COACH_CRITERIA.find((k) => k.key === c.key)
    if (i === 2) {
      lines.push('### 3. Commercial Outcome — NOT SCORED')
      lines.push(card.commercial_outcome_summary
        ? `${outcomeLabel(card.declared_outcome)}. ${card.commercial_outcome_summary}`
        : `**${card.commercial_outcome_label}** — ${card.commercial_outcome_note}`)
      lines.push('')
    }
    lines.push(`### ${meta?.number ?? i + 1}. ${meta?.label || c.label} — ${verdictRating(c.verdict)}`)
    if (c.verdict === 'na') {
      if (c.note) lines.push(`Not applicable: ${c.note}`)
      if (c.reason) lines.push(`**Assessment:** ${c.reason}`)
      lines.push('')
      return
    }
    if (c.note) lines.push(`_${c.note}_`)
    const ev = c.evidence || []
    const evText = (e: SalesCoachEvidence) => {
      const label = evidenceLabel(e.label)
      const time = e.time_ms !== undefined ? `[${formatTimestamp(e.time_ms)}] ` : ''
      return `${time}${label ? `${label}: ` : ''}${e.text}`
    }
    if (ev.length === 1) lines.push(`**Evidence:** ${evText(ev[0])}`)
    else if (ev.length > 1) {
      lines.push('**Evidence:**')
      ev.forEach((e) => lines.push(`- ${evText(e)}`))
      lines.push('')
    }
    if (c.reason) lines.push(`**Assessment:** ${c.reason}`)
    if (c.commercial_reality) lines.push(`**Commercial reality:** ${c.commercial_reality}`)
    if (c.better_approach) lines.push(`**Better approach:** ${c.better_approach}`)
    lines.push('')
  })

  lines.push('## E. Deeper Coaching')
  lines.push('### Objections and Handling')
  if (card.objections.length > 0) {
    card.objections.forEach((o, i) => {
      if (card.objections.length > 1) lines.push(`**${i + 1}.**`)
      lines.push(`**Objection:** ${o.objection}`)
      lines.push(`**How you handled it:** ${o.handled}`)
      if (o.original_wording || o.trc_improved_response) {
        lines.push('**TRC-improved response:**')
        if (o.original_wording) lines.push(`Original: ${o.original_wording}`)
        if (o.trc_improved_response) lines.push(`TRC doctrine: ${o.trc_improved_response}`)
      }
      if (o.principle) lines.push(`**Relevant principle:** ${o.principle}`)
      lines.push('')
    })
  } else {
    lines.push('No genuine objections were raised in the transcript.')
    lines.push('')
  }
  for (const s of card.deeper_analysis) {
    lines.push(`### ${titleCaseHeading(s.heading)}`)
    lines.push(s.body)
    lines.push('')
  }
  lines.push('### Final Coaching Question')
  lines.push(card.coaching_question)
  lines.push('')
  if (card.coaching_invitation) {
    lines.push('### Continue With Your Coach')
    lines.push(card.coaching_invitation)
    lines.push('')
  }

  lines.push('## F. Overall Execution Score')
  lines.push(`**Overall Execution Score: ${formatOverallScore(card)}**`)
  return lines.join('\n').trim() + '\n'
}

// "RETORNO CONTROL" → "Retorno Control", keeping short all-caps acronyms
// (CEO, TRC) as written.
export function titleCaseHeading(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|\s|-)\S/g, (m) => m.toUpperCase())
    .replace(/\b(Ceo|Trc|Ots|Q&a)\b/g, (m) => m.toUpperCase())
}

// ────────────────────────────────────────────────────────────────────────────
// Structured-output schema for the analysis call (Anthropic JSON outputs). The
// model fills judgement fields only; labels, `scored` flags and the score are
// computed in code (see validateReportCard).
// ────────────────────────────────────────────────────────────────────────────

export const REPORT_CARD_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'The result line of A. NEGOTIATION RESULT, printed right after the outcome label the system supplies ("FOLLOW-UP / RETORNO — <this>"), so do NOT repeat the label. One sentence leading with the commercial result: the space and price signed (won), the precise space and price discussed and its status (retorno, e.g. "Half page at USD 25,000 proposed; not yet agreed."), "OPEN, NO SPACE AGREED UPON" for a retorno with no defined basis, or the stated reason (lost). It may go on to name the principal strength and the one important improvement, as the Project Prompt\'s headline format shows (e.g. "Full page at USD 30,000 signed on the spot; strong editorial buildup, with one important improvement: confirm the selection verbally before preparing the contract."). Never present a proposed price as agreed. NEVER a score, percentage or points.',
    },
    summary: {
      type: 'string',
      description: 'The paragraph under the result line, addressed to the Sales Executive as "you"/"your": the commercial position actually reached (e.g. CEO interest vs confirmed buy-in) and what you secured, reflecting both the result and how well the negotiation was executed; then, for a retorno, the immediate commercial priority (otherwise the most important improvement for the next call). 2-4 concise sentences — B and C carry the detailed strengths and improvements. A signed deal reads as a success even when the process had gaps. No score.',
    },
    commercial_outcome_summary: {
      type: 'string',
      description: 'Section 3, COMMERCIAL OUTCOME — NOT SCORED: the factual detail printed after the declared outcome ("Retorno. <this>"), so do NOT repeat the outcome word. The space and price signed or discussed and their status, plus the agreed next step, e.g. "Half page at USD 25,000 proposed, not agreed. Marketing meeting scheduled." For a retorno with no defined basis: "OPEN, NO SPACE AGREED UPON." 1-2 short sentences.',
    },
    strengths: {
      type: 'array',
      description: 'B. WHAT YOU DID WELL: two or three genuine strengths grounded in transcript evidence — fewer if fewer are supported. Recognise a signature prominently.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short label, e.g. "Strong editorial buildup".' },
          detail: { type: 'string', description: 'One sentence of evidence-based explanation, addressed to "you", e.g. "You connected the CEO\'s interview messages to the value of appearing in the publication."' },
        },
        required: ['title', 'detail'],
        additionalProperties: false,
      },
    },
    improvements: {
      type: 'array',
      description: 'C. MAIN AREAS FOR IMPROVEMENT: the two or three highest-impact CONTROLLABLE improvements, each with a specific next-time action — fewer if fewer are warranted. No repetitive or minor criticisms, never an audio/transcription limitation.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short label, e.g. "Make CEO buy-in more explicit".' },
          detail: { type: 'string', description: 'One or two sentences: what happened and the specific next-time action, addressed to "you", e.g. "You asked whether the CEO liked the proposal, but did not follow up with a direct participation question."' },
        },
        required: ['title', 'detail'],
        additionalProperties: false,
      },
    },
    criteria: {
      type: 'array',
      description: 'Exactly these eight scored criteria (Commercial Outcome is rendered separately by the system and is never one of them), in order, each exactly once.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: CRITERION_KEYS },
          verdict: { type: 'string', enum: VERDICTS },
          note: {
            type: 'string',
            description: 'Short text after the verdict mark. For N/A: why it does not apply (e.g. "outcome is signed", or which Project Prompt N/A condition is met). Empty string otherwise.',
          },
          evidence: {
            type: 'array',
            description: 'The "Evidence:" line(s) — one, or two or three where the Project Prompt asks for more than one quote (the offer AND the closing question; your question AND the CEO\'s response). Each is a verbatim transcript quote in double quotes, or (where no single line captures it) a short factual description of conduct, e.g. "You presented two clearly defined options, their prices and a closing question." Label each by what it is: "Quote", "Your question", "CEO\'s response", "Offer quoted", "Closing question", "Subsequent conduct", "Conduct". Empty array if none.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                text: { type: 'string' },
              },
              required: ['label', 'text'],
              additionalProperties: false,
            },
          },
          reason: { type: 'string', description: 'The "Assessment:" line — why this EXECUTION rating, in one or two sentences of TRC coaching language: the quality of the attempt, kept separate from the buyer\'s response, e.g. "You attempted to test interest but did not ask clearly for participation." Empty string only for a self-explanatory N/A.' },
          commercial_reality: {
            type: 'string',
            description: 'The "Commercial reality:" line for criteria 4-9 — the buyer-controlled fact, stated SEPARATELY from the execution rating, short and plain, using the Project Prompt\'s status where it defines one: 4 buy-in confirmed / not confirmed / declined / unverifiable (e.g. "CEO interest, not confirmed buy-in."); 5 the option selected or none (e.g. "No option selected."); 6 the actual retorno basis (e.g. "No agreed space or price."); 7 the actual agreement (e.g. "Terms not agreed."); 8 what was confirmed about authority and the handoff; 9 the meeting status — CONFIRMED only with a fixed date and time / TENTATIVE / NOT SCHEDULED / DECLINED. Empty string for criteria 1-2 and for N/A.',
          },
          better_approach: {
            type: 'string',
            description: 'The "Better approach:" line — for a ⚠️ or ❌ where a different question or response is the fix: the exact TRC-consistent words you could have used, short enough to say to a CEO, in double quotes, e.g. "In principle, would you like your company to participate in this edition?". Empty string for ✅, N/A and UV, or when the fix is not a phrasing.',
          },
        },
        required: ['key', 'verdict', 'note', 'evidence', 'reason', 'commercial_reality', 'better_approach'],
        additionalProperties: false,
      },
    },
    objections: {
      type: 'array',
      description: 'Every real objection or hesitation the buyer raised. Empty array if none.',
      items: {
        type: 'object',
        properties: {
          objection: { type: 'string', description: 'The objection or hesitation, quoted verbatim.' },
          handled: { type: 'string', description: 'How you actually handled it, addressed to the Sales Executive as "you".' },
          original_wording: { type: 'string', description: 'What you said, verbatim. Empty if not applicable.' },
          trc_improved_response: { type: 'string', description: 'What TRC doctrine would have said instead, in natural spoken words ending in a question. Empty if the handling was already correct.' },
          principle: { type: 'string', description: 'The relevant TRC principle from the Manual or Method.' },
        },
        required: ['objection', 'handled', 'original_wording', 'trc_improved_response', 'principle'],
        additionalProperties: false,
      },
    },
    deeper_analysis: {
      type: 'array',
      description: 'Zero to three further DEEPER COACHING sections on important missed opportunities the criteria did not already cover (e.g. a missed CEO emotional-close window, a delegation that should have been reconfirmed), each with concise alternative TRC wording. UPPER-CASE headings (e.g. "CEO EMOTIONAL CLOSE", "CONCISE CONFIRMATION APPLICATION", "RETORNO CONTROL"). Only when they add something.',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['heading', 'body'],
        additionalProperties: false,
      },
    },
    coaching_question: {
      type: 'string',
      description: 'Exactly ONE tailored reflective question about the most important controllable MEETING-EXECUTION issue, addressed to the Sales Executive as "you". Never about an audio, transcription or metadata limitation.',
    },
    next_commercial_priority: {
      type: 'string',
      description: 'One short sentence: the grounded immediate commercial priority for THIS opportunity, from the recorded evidence and known facts only. Retorno: the conversion priority. Signed: a relevant contract/implementation item, or empty if none. Lost: a recovery route only if the evidence supports one credibly, otherwise empty. Never invent commitments, prices or approvals.',
    },
    submission_is_summary: {
      type: 'boolean',
      description: 'true ONLY when the submitted text is plainly a summary, notes or a description of the meeting rather than a transcript of the conversation itself (no actual exchange between the speakers). A partial transcript that still shows the planteo, the objection handling and the outcome is NOT a summary: score it and say in the summary that the evaluation is based on the available segment. When true, the card is not shown and the Sales Executive is asked for the complete transcript, per the Project Prompt.',
    },
    coaching_invitation: {
      type: 'string',
      description: 'The short two-track invitation that closes DEEPER COACHING, right before the final score: offer (a) practising the meeting skill behind the coaching question, OR (b) planning the next commercial action for this opportunity (naming the grounded priority for a retorno; implementation for a won deal; recovery only if credible for a lost one), and ask which would help most right now. 1-3 sentences, specific to this negotiation, no generic script. No score.',
    },
  },
  required: [
    'headline', 'summary', 'commercial_outcome_summary', 'strengths', 'improvements', 'criteria',
    'objections', 'deeper_analysis', 'coaching_question',
    'next_commercial_priority', 'coaching_invitation', 'submission_is_summary',
  ],
  additionalProperties: false,
} as const

// ────────────────────────────────────────────────────────────────────────────
// Fixed output contract for the analysis call. Placed LAST in the system
// prompt, after the admin-editable knowledge documents, on purpose: the card's
// STRUCTURE and the score ARITHMETIC are owned by the code (they are validated
// and recomputed here), while the JUDGEMENT thresholds for each verdict come
// from the Project Prompt / Manual / Method. Same "contract last so it wins on
// format" pattern as the document modules' OUTPUT_CONTRACT.
// ────────────────────────────────────────────────────────────────────────────

export const REPORT_CARD_CONTRACT = `=== REPORT CARD OUTPUT CONTRACT (fixed — overrides any formatting instructions above) ===

You are producing the TRC Sales Coach REPORT CARD for ONE negotiation, as a single JSON object matching the provided schema. No prose outside the JSON.

HOW THIS CONTRACT RELATES TO THE PROJECT PROMPT: the Project Prompt (loaded above, highest authority) is where the real judgement lives — its execution-versus-result thresholds for every criterion, its CONFIRMED OUTCOME METADATA, OUTCOME STATUS VERSUS SUPPORTING METADATA, NON-VERBAL OUTCOME IS NOT A COACHING GAP and TRANSCRIPTION AND SPEAKER UNCERTAINTY rules govern exactly how to judge the negotiation, treat the declared outcome and submitted details, and handle garbled or ambiguous audio (mark UV rather than guessing or penalising). Follow those rules as written; this contract does not add to or override them. What this contract fixes is STRUCTURE only.

HOW THE FIELDS MAP TO THE REPORT CARD (the system prints the header — Company, Meeting, Outcome — and renders the sections, in this order, from your fields):
A. Negotiation Result — the system prints the outcome label ("FOLLOW-UP / RETORNO — "); you write headline (the result after the dash) and summary (the short paragraph under it).
B. What You Did Well — strengths[] (two or three; fewer if fewer are supported).
C. Main Areas for Improvement — improvements[] (two or three highest-impact controllable ones; fewer if fewer are warranted).
D. Detailed Performance Assessment — criteria[], each printed as "<n>. <Name> — ✅ Strong (1) / ⚠️ Partial (0.5) / ❌ Weak (0)", then Evidence: (evidence[]), Assessment: (reason), Commercial reality: (commercial_reality, criteria 4-9) and Better approach: (better_approach, when useful). The system inserts "3. Commercial Outcome — NOT SCORED" between 2 and 4 from the declared outcome plus your commercial_outcome_summary.
E. Deeper Coaching — objections[], deeper_analysis[], then coaching_question (exactly one), then coaching_invitation (the two-track invitation), with next_commercial_priority as its grounded priority.
F. Overall Execution Score — computed and printed by the system, LAST. NEVER write a score, percentage, points total or "X/Y" anywhere in your fields.

CRITERIA: Commercial Outcome (Section 3) is rendered by the system and is not one of your criteria. The remaining eight sections are numbered 1, 2, 4, 5, 6, 7, 8, 9 and are exactly what you score in criteria[], each exactly once, no more and no fewer:
1. sales_offer_buildup
2. offer_articulation
4. ceo_buyin
5. ceo_preference
6. space_price_retorno
7. space_price_agreement
8. next_steps_stakeholders
9. scheduled_meeting
Each verdict rates the Sales Executive's EXECUTION. For criteria 4-9 put the buyer-controlled commercial fact in commercial_reality, separately (e.g. "CEO interest, not confirmed buy-in."); a refusal does not by itself lower the verdict and a signature does not by itself earn it. Apply the Project Prompt's own thresholds and examples. If the Project Prompt is silent on a point, use the Manual and Method. The Follow-Up & Conversion Playbook is for next_commercial_priority and coaching_invitation only — never use it to score the recorded negotiation.

OFF-RECORDING FACTS: a declared or confirmed fact that did not itself happen on the recording (e.g. a contract signed after the call ended, a decision made in a later off-audio conversation) is NOT a contradiction to penalise. Note it factually and matter-of-factly — in the summary or the relevant criterion's reason — as a natural limit of reviewing only the recorded portion (e.g. "this was agreed after the recorded portion of the call, so I can only speak to what's on the audio"), never as a discrepancy or a mark against the Sales Executive.

CONFIRMED CORRECTIONS & FEEDBACK: if the submission includes a "CONFIRMED CORRECTIONS & FEEDBACK FROM THE SALES EXECUTIVE" block, entries scoped to a specific criterion or the Commercial Outcome are ground truth — supersede your own reading of the transcript for that specific fact, do not mark the corrected criterion "uv" for that reason again, and do not describe it as a discrepancy. Entries labelled "General feedback" are not tied to one criterion — weigh them as context from the Sales Executive when writing the summary and reasons, without forcing them onto a single criterion that may not fit.

VOICE (mandatory): address the Sales Executive DIRECTLY as "you"/"your" throughout — headline, summary, strengths, improvements, every criterion's reason, objections, the coaching question and the invitation. Never write "the Sales Executive", "the rep" or "the representative" in third person; never call the role anything but "Sales Executive" if you must name it at all. If the CEO's name is unclear, write "the CEO" — never a bracketed placeholder.

APPLICABILITY (the submission lists which criteria are N/A for this negotiation — follow it exactly):
- Always N/A: Signed on the spot → 6 and 9. Lost → 6 and 9. Retorno and Uncertain → none.
- N/A only under the Project Prompt's stated condition, explained in the note: 7 (no commercial offer reached for reasons outside your control) for Retorno, Lost and Uncertain; 8 (signed with no additional stakeholder involvement required) for Signed.
Never mark any other criterion "na". If something did not happen, that is a judgement (usually fail or warn), not N/A.

SCORE ARITHMETIC (recomputed in code — do not compute it yourself): pass = 1 point, warn = 0.5, fail = 0; na and uv are excluded from the applicable total. All applicable criteria carry equal weight.

EVIDENCE RULES: every pass/warn/fail must be supported in evidence[] by a direct quote, a close paraphrase or clearly described conduct from the transcript, as the Project Prompt requires — quote verbatim wherever a line exists (labels: "Quote", "Your question", "CEO's response", "Offer quoted", "Closing question", "Subsequent conduct"); use a described-conduct line (label "Conduct", no quotation marks) only where no single line captures it. Quote exactly as transcribed, in the transcript's language, wrapped in double quotes; if a quote is in a different language from the card, add a short gloss in the card's language in brackets. NEVER invent, paraphrase into quotes, or borrow dialogue from the Examples or the Playbook. If no quote exists, say so in reason.

STYLE (TRC coaching method): recognise the genuine strengths first, with evidence; then be direct about the decisive moment and its commercial consequence; show the exact words you could have used, short enough to say to a CEO and ending in a question; natural professional language, no generic sales jargon, no motivational padding. A signed deal leads as a success even when the process had gaps. The Examples document is for pattern recognition only — never import its facts, numbers or dialogue.

LANGUAGE: follow the Project Prompt's language rule — write every field in the language of the transcript; if the transcript is mixed, write in English. (The section labels around your fields are printed by the system in English.)

OBJECTIONS: list every GENUINE objection the buyer raised (not every clarification, price acknowledgement or neutral comment), how you handled it, your original wording, the TRC-doctrine alternative, and the principle it comes from. If you handled it correctly, say so and leave the alternative empty.

deeper_analysis: 0-3 sections on important missed opportunities the criteria did not already cover, each with concise alternative TRC wording, only when they add something (e.g. CEO EMOTIONAL CLOSE, CONCISE CONFIRMATION APPLICATION, RETORNO CONTROL, DELEGATION AND AUTHORITY). coaching_question: exactly one, about meeting execution. coaching_invitation: short, specific, offers both tracks without requiring either to come first.

submission_is_summary: the Project Prompt's WHAT TO DO IF THE SUBMISSION IS INCOMPLETE rule — true only when the text is plainly a summary or notes rather than the conversation itself; then the Sales Executive is asked for the complete transcript instead of being shown a card. Otherwise false (a partial transcript that shows the planteo, objection handling and outcome is scored, saying the evaluation is based on the available segment).`

// The one-time privacy/data-use notice (US-047) — exact verbatim text.
export const SALES_COACH_PRIVACY_NOTICE =
  'Negotiation files and related data are securely retained by TRC and may be used internally for coaching, training, performance analysis and improvement of TRC’s AI tools, in accordance with TRC’s Privacy Policy.'
