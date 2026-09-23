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

// The four admin-managed knowledge documents, in their fixed authority order
// (US-038). Order matters: the array itself is the authority hierarchy used
// when assembling the AI context.
export const SALES_COACH_KNOWLEDGE_DOCS: {
  key: SalesCoachKnowledgeKey
  label: string
  description: string
}[] = [
  { key: 'project_prompt', label: 'Sales Coach Project Prompt', description: 'The main system instruction and highest-authority document. Governs how every Report Card is produced.' },
  { key: 'manual', label: 'Manual — TRC Overcoming Objections', description: 'Objection-handling doctrine and the planteo build-up formula referenced when offer build-up scores weak.' },
  { key: 'method', label: 'TRC Sales Coaching Method', description: 'The coaching method and evaluation approach.' },
  { key: 'examples', label: 'TRC Successful Negotiation Examples', description: 'Pattern-recognition reference only — its facts are never imported into another negotiation.' },
]

export function isSalesCoachKnowledgeKey(v: unknown): v is SalesCoachKnowledgeKey {
  return v === 'project_prompt' || v === 'manual' || v === 'method' || v === 'examples'
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
// rendered instead. `heading` is the upper-case section title used in the
// text rendering; `label` is the display name in the UI.
export const SALES_COACH_CRITERIA: { key: string; label: string; heading: string; number: number }[] = [
  { key: 'sales_offer_buildup', label: 'Sales Offer Build-up', heading: 'SALES OFFER BUILDUP', number: 1 },
  { key: 'offer_articulation', label: 'Offer Articulation', heading: 'OFFER ARTICULATION', number: 2 },
  { key: 'ceo_buyin', label: 'CEO Buy-in', heading: 'CEO BUY-IN', number: 4 },
  { key: 'ceo_preference', label: 'CEO Preference', heading: 'CEO PREFERENCE', number: 5 },
  { key: 'space_price_retorno', label: 'Space & Price for Retorno', heading: 'SPACE & PRICE FOR RETORNO', number: 6 },
  { key: 'space_price_agreement', label: 'Space and Price Agreement', heading: 'SPACE AND PRICE AGREEMENT', number: 7 },
  { key: 'next_steps_stakeholders', label: 'Next Steps and Stakeholders', heading: 'NEXT STEPS AND STAKEHOLDERS', number: 8 },
  { key: 'scheduled_meeting', label: 'Scheduled Meeting', heading: 'SCHEDULED MEETING', number: 9 },
]

const CRITERION_KEYS = SALES_COACH_CRITERIA.map((c) => c.key)
const VERDICTS: SalesCoachVerdict[] = ['pass', 'warn', 'fail', 'na', 'uv']

// Which criteria are N/A is a FIXED rule keyed to the declared outcome, not a
// per-run model judgement — otherwise the same negotiation scored "5/7" one
// run and "5/8" the next. The denominator is therefore static per outcome
// path: signed 6, retorno 7, lost 5, uncertain 8 of the eight scored criteria
// (only a rare UV lowers it further) — matches the Project Prompt's own
// "Sections 1, 2 and 4–9" denominator rule now that Commercial Outcome (3)
// is excluded.
export const NA_BY_DECLARED_OUTCOME: Record<SalesCoachOutcome, string[]> = {
  signed: ['space_price_retorno', 'scheduled_meeting'],
  retorno: ['space_price_agreement'],
  lost: ['space_price_retorno', 'space_price_agreement', 'scheduled_meeting'],
  uncertain: [],
}

export function fixedNaCriteria(declared: SalesCoachOutcome | null | undefined): string[] {
  return declared ? NA_BY_DECLARED_OUTCOME[declared] : []
}

export function applicableCriteriaCount(declared: SalesCoachOutcome | null | undefined): number {
  return SALES_COACH_CRITERIA.length - fixedNaCriteria(declared).length
}

function criterionNumber(key: string): number {
  return SALES_COACH_CRITERIA.find((c) => c.key === key)?.number ?? 0
}

// Per-run instruction appended to the submission so the model applies the
// table on the first pass (the validator enforces it regardless).
export function applicabilityInstruction(declared: SalesCoachOutcome | null | undefined): string {
  const na = fixedNaCriteria(declared)
  const label = outcomeLabel(declared)
  const naList = na.length
    ? na.map((k) => { const c = SALES_COACH_CRITERIA.find((c) => c.key === k)!; return `${c.number}. ${c.label}` }).join('; ')
    : 'none'
  return `--- APPLICABLE CRITERIA (fixed rule for a negotiation declared "${label}") ---
N/A, by rule: ${naList}. Give these the verdict "na" with a one-line note.
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

// ────────────────────────────────────────────────────────────────────────────
// Coaching-tab personalization — replaces four fixed generic starter prompts
// with ones drawn from THIS negotiation's own Report Card, so the chat feels
// like a continuation of what the Sales Executive just read rather than a
// blank box they have to think of something to type into.
// ────────────────────────────────────────────────────────────────────────────

export function coachGreeting(card: SalesCoachReportCard, company: string | null): string {
  return `I've read your Report Card${company ? ` for ${company}` : ''}, the full transcript and the TRC knowledge documents. ${card.headline} Ask me anything, or start here:`
}

// Weakest scored criteria first (fail, then warn), turned into a direct
// "fix this" prompt; the model's own verdict, not re-judged here. Falls back
// to two generic prompts if the card has nothing to improve on (or isn't a
// scored criterion at all), so this never returns fewer than the featured
// coaching question plus one other option.
export function suggestedCoachingPrompts(card: SalesCoachReportCard): SalesCoachCoachingPrompt[] {
  const prompts: SalesCoachCoachingPrompt[] = []
  if (card.coaching_question) {
    prompts.push({ label: 'Your coach’s question', prompt: card.coaching_question })
  }
  const weight = (v: SalesCoachVerdict) => (v === 'fail' ? 0 : v === 'warn' ? 1 : 2)
  const weak = card.criteria
    .filter((c) => c.scored && (c.verdict === 'fail' || c.verdict === 'warn'))
    .sort((a, b) => weight(a.verdict) - weight(b.verdict))
  for (const c of weak.slice(0, 3)) {
    const meta = SALES_COACH_CRITERIA.find((k) => k.key === c.key)
    const label = meta?.label || c.label
    prompts.push({
      label: `Fix your ${label}`,
      prompt: `I scored ${verdictMark(c.verdict)} on ${label}. Walk me through exactly what I should have said, and what to do differently next time.`,
    })
  }
  if (prompts.length < 2) {
    prompts.push({ label: 'Walk me through my Report Card', prompt: 'Walk me through my Report Card.' })
  }
  if (prompts.length < 2) {
    prompts.push({ label: 'What matters most for next time?', prompt: 'If I could only fix one thing before my next negotiation, what should it be and why?' })
  }
  return prompts.slice(0, 4)
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
  if (declared === 'signed') return 'POSITIVE / WON'
  if (declared === 'lost') return 'NEGATIVE / LOST'
  if (declared === 'retorno') {
    const d = details || {}
    if (d.noneEstablished === true) return 'FOLLOW-UP / RETORNO — OPEN, NO SPACE AGREED UPON'
    const opt1 = formatOutcomeDetails(declared, details).find((r) => r.label === 'Option 1')?.value
    return opt1 ? `FOLLOW-UP / RETORNO — ${opt1}` : 'FOLLOW-UP / RETORNO — OPEN, NO SPACE AGREED UPON'
  }
  if (declared === 'uncertain') return 'UNCERTAIN'
  return 'NOT DECLARED'
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
// the typed field always wins.
export function deriveCompanyFromFilename(filename: string | null | undefined): string | null {
  if (!filename) return null
  const base = filename.replace(/\.[a-z0-9]{2,5}$/i, '')
  const cleaned = base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : null
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

// Structural validation of the model's Report Card. We do NOT trust the model's
// arithmetic or completeness — this checks every criterion is present exactly
// once with a valid verdict, the required prose fields are filled, and exactly
// one coaching question exists; then it normalises the object (fixed criterion
// order, labels, `scored` flags) and recomputes the score. Returns the list of
// problems (empty = valid) so the route can trigger one corrective pass.
export function validateReportCard(
  rc: unknown,
  ctx: { company: string; declaredOutcome: SalesCoachOutcome | null; outcomeDetails?: Record<string, unknown> | null },
): { ok: boolean; problems: string[]; normalized?: SalesCoachReportCard } {
  const problems: string[] = []
  if (!rc || typeof rc !== 'object' || Array.isArray(rc)) {
    return { ok: false, problems: ['Report card is not a JSON object'] }
  }
  const card = rc as Record<string, unknown>

  if (!str(card.headline)) problems.push('Missing headline')
  if (!str(card.summary)) problems.push('Missing summary')
  if (!str(card.report_summary)) problems.push('Missing report_summary')
  if (!str(card.coaching_question)) problems.push('Missing the single coaching question')

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
    // Applicability is a fixed rule (see NA_BY_DECLARED_OUTCOME): a model "na"
    // outside the rule is a missing judgement, not a valid verdict.
    if (verdict === 'na' && !fixedNa.has(key) && ctx.declaredOutcome) {
      problems.push(`Criterion ${label} cannot be N/A for a negotiation declared "${outcomeLabel(ctx.declaredOutcome)}" — give pass, warn or fail with evidence`)
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
      scored: isScoredVerdict(verdict),
    }
  })

  const { score, denominator } = recomputeScore(criteria)

  const normalized: SalesCoachReportCard = {
    company: ctx.company,
    declared_outcome: ctx.declaredOutcome,
    commercial_outcome_label: commercialOutcomeLabel(ctx.declaredOutcome, ctx.outcomeDetails),
    commercial_outcome_note: commercialOutcomeNote(ctx.declaredOutcome, ctx.outcomeDetails),
    headline: str(card.headline),
    execution_score: score,
    execution_denominator: denominator,
    summary: str(card.summary),
    criteria,
    report_summary: str(card.report_summary),
    objections: cleanObjections(card.objections),
    deeper_analysis: cleanSections(card.deeper_analysis),
    coaching_question: str(card.coaching_question),
  }
  return { ok: true, problems: [], normalized }
}

// ────────────────────────────────────────────────────────────────────────────
// Text rendering — the layout of the client's sample Report Card, as markdown.
// Derived from the structured card so the text and the UI can never disagree.
// ────────────────────────────────────────────────────────────────────────────

export function renderReportCardMarkdown(card: SalesCoachReportCard): string {
  const lines: string[] = []
  const outcomeLbl = card.commercial_outcome_label
  const scoreText = `${formatScore(card.execution_score, card.execution_denominator)} scored criteria${scoreCoverageSuffix(card.criteria)}`
  lines.push('# REPORT CARD')
  lines.push(`**${outcomeLbl} — ${scoreText} — ${card.headline}**`)
  lines.push('')
  lines.push(card.summary)
  lines.push('')

  // Sections 1 and 2, then Section 3 (Commercial Outcome — not scored, the
  // Project Prompt's own numbering), then the remaining scored criteria.
  card.criteria.forEach((c, i) => {
    const meta = SALES_COACH_CRITERIA.find((k) => k.key === c.key)
    if (i === 2) {
      lines.push('## 3. COMMERCIAL OUTCOME — NOT SCORED')
      lines.push(`**${outcomeLbl}**`)
      lines.push(card.commercial_outcome_note)
      lines.push('')
    }
    lines.push(`## ${meta?.number ?? i + 1}. ${meta?.heading || c.label.toUpperCase()}`)
    if (c.verdict === 'na') {
      lines.push(`**N/A${c.note ? ` — ${c.note}` : ''}**`)
    } else if (c.verdict === 'uv') {
      lines.push(`**UV — audio verification required${c.note ? ` — ${c.note}` : ''}**`)
    } else {
      lines.push(`**${verdictMark(c.verdict)}${c.note ? ` — ${c.note}` : ''}**`)
    }
    for (const e of c.evidence || []) lines.push(`**${e.label}${e.time_ms !== undefined ? ` [${formatTimestamp(e.time_ms)}]` : ''}:** ${e.text}`)
    if (c.reason) lines.push(`**Reason:** ${c.reason}`)
    lines.push('')
  })

  lines.push('## SCORELINE')
  lines.push(`**Execution Score:** ${formatScore(card.execution_score, card.execution_denominator).replace('/', ' / ')} scored criteria${scoreCoverageSuffix(card.criteria)}`)
  lines.push(`**Commercial Outcome:** ${outcomeLbl}`)
  lines.push(`**Report Summary:** ${card.report_summary}`)
  lines.push('')

  lines.push('# DEEPER ANALYSIS AND FEEDBACK')
  if (card.objections.length > 0) {
    lines.push('## OBJECTIONS & HANDLING')
    card.objections.forEach((o, i) => {
      if (card.objections.length > 1) lines.push(`**${i + 1}.**`)
      lines.push(`**Objection/Hesitation:** ${o.objection}`)
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
    lines.push('## OBJECTIONS & HANDLING')
    lines.push('No objections or hesitations were raised in the transcript.')
    lines.push('')
  }
  for (const s of card.deeper_analysis) {
    lines.push(`## ${s.heading}`)
    lines.push(s.body)
    lines.push('')
  }
  lines.push('## FINAL COACHING QUESTION')
  lines.push(card.coaching_question)
  return lines.join('\n').trim() + '\n'
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
      description: 'One sentence: the single most important execution note from the negotiation.',
    },
    summary: {
      type: 'string',
      description: 'The opening paragraph, addressed to the Sales Executive as "you"/"your": what you did across the negotiation and the main improvement for next time. 3-5 sentences.',
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
            description: 'Short text after the verdict mark. For N/A: why it does not apply (e.g. "outcome is signed"). Empty string otherwise.',
          },
          evidence: {
            type: 'array',
            description: 'Verbatim transcript evidence lines. Labels such as "Quote", "Offer quoted", "Leading question quoted", "Subsequent conduct". Empty array if none.',
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
          reason: { type: 'string', description: 'Why this verdict, in TRC coaching language. Empty string only for a self-explanatory N/A.' },
        },
        required: ['key', 'verdict', 'note', 'evidence', 'reason'],
        additionalProperties: false,
      },
    },
    report_summary: {
      type: 'string',
      description: 'The SCORELINE report summary: 2-3 sentences on what was delivered and the one meaningful gap.',
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
      description: 'Zero to three further analysis sections with UPPER-CASE headings (e.g. "CONCISE CONFIRMATION APPLICATION", "RETORNO CONTROL"). Only when they add something the criteria did not.',
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
      description: 'Exactly ONE focused coaching question, addressed to the Sales Executive as "you", tied to the decisive moment.',
    },
  },
  required: [
    'headline', 'summary', 'criteria', 'report_summary',
    'objections', 'deeper_analysis', 'coaching_question',
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

HOW THIS CONTRACT RELATES TO THE PROJECT PROMPT: the Project Prompt (loaded above, highest authority) is where the real judgement lives — its CONFIRMED OUTCOME METADATA, OUTCOME STATUS VERSUS SUPPORTING METADATA, NON-VERBAL OUTCOME IS NOT A COACHING GAP and TRANSCRIPTION AND SPEAKER UNCERTAINTY rules govern exactly how to treat the declared outcome, the submitted details, and any garbled or ambiguous audio (mark UV rather than guessing or penalising). Follow those rules as written; this contract does not add to or override them. What this contract fixes is STRUCTURE only:
- Commercial Outcome (Section 3 of the Project Prompt's report format) is rendered by the system from the declared outcome and outcome details, exactly as "Commercial Outcome — NOT SCORED... never included [in the denominator]" requires. It is not one of your criteria and you never author it.
- The remaining eight sections are numbered 1, 2, 4, 5, 6, 7, 8, 9 (3 is reserved for Commercial Outcome) and are exactly what you score in criteria[], each exactly once, no more and no fewer:
1. sales_offer_buildup
2. offer_articulation
4. ceo_buyin
5. ceo_preference
6. space_price_retorno
7. space_price_agreement
8. next_steps_stakeholders
9. scheduled_meeting
Apply the Project Prompt's own verdict thresholds and examples for each of these. If the Project Prompt is silent on a point, use the Manual and Method.

OFF-RECORDING FACTS: a declared or confirmed fact that did not itself happen on the recording (e.g. a contract signed after the call ended, a decision made in a later off-audio conversation) is NOT a contradiction to penalise. Note it factually and matter-of-factly — in the summary or the relevant criterion's reason — as a natural limit of reviewing only the recorded portion (e.g. "this was agreed after the recorded portion of the call, so I can only speak to what's on the audio"), never as a discrepancy or a mark against the Sales Executive.

CONFIRMED CORRECTIONS & FEEDBACK: if the submission includes a "CONFIRMED CORRECTIONS & FEEDBACK FROM THE SALES EXECUTIVE" block, entries scoped to a specific criterion or the Commercial Outcome are ground truth — supersede your own reading of the transcript for that specific fact, do not mark the corrected criterion "uv" for that reason again, and do not describe it as a discrepancy. Entries labelled "General feedback" are not tied to one criterion — weigh them as context from the Sales Executive when writing the summary and reasons, without forcing them onto a single criterion that may not fit.

VOICE (mandatory): address the Sales Executive DIRECTLY as "you"/"your" throughout — headline, summary, every criterion's reason, report_summary, objections and the coaching question. Never write "the Sales Executive", "the rep" or "the representative" in third person; never call the role anything but "Sales Executive" if you must name it at all. Write as if speaking straight to the person who ran the negotiation.

APPLICABILITY IS A FIXED RULE, keyed to the DECLARED outcome (the submission tells you which criteria are N/A for this negotiation — follow it exactly):
- Signed on the spot → 6 and 9 are N/A (6 applicable points).
- Retorno → 7 is N/A (7 applicable points).
- Lost → 6, 7 and 9 are N/A (5 applicable points).
- Uncertain → nothing is N/A (8 applicable points).
Never mark any other criterion "na". If something did not happen, that is a judgement (usually fail or warn), not N/A.

SCORE ARITHMETIC (recomputed in code — do not compute it yourself): pass = 1 point, warn = 0.5, fail = 0; na and uv are excluded from the applicable total.

EVIDENCE RULES: every pass/warn/fail must cite verbatim transcript evidence in evidence[] (labels: "Quote", "Offer quoted", "Leading question quoted", "Subsequent conduct", or similar). Quote exactly as transcribed, in the transcript's language, wrapped in double quotes; add a short English gloss in brackets if the quote is not in English. NEVER invent, paraphrase into quotes, or borrow dialogue from the Examples document. If no quote exists, say so in reason.

STYLE (TRC coaching method): recognise the genuine strengths first, with evidence; then be direct about the decisive moment and its commercial consequence; show the exact words you could have used, short enough to say to a CEO and ending in a question; natural professional language, no generic sales jargon, no motivational padding. The Examples document is for pattern recognition only — never import its facts, numbers or dialogue. Write in English.

OBJECTIONS: list every real objection or hesitation the buyer raised, how you handled it, your original wording, the TRC-doctrine alternative, and the principle it comes from. If you handled it correctly, say so and leave the alternative empty.

deeper_analysis: 0-3 sections only when they add something (e.g. CONCISE CONFIRMATION APPLICATION, RETORNO CONTROL, TEAM CHOREOGRAPHY). coaching_question: exactly one, tied to the decisive moment.`

// The one-time privacy/data-use notice (US-047) — exact verbatim text.
export const SALES_COACH_PRIVACY_NOTICE =
  'Negotiation files and related data are securely retained by TRC and may be used internally for coaching, training, performance analysis and improvement of TRC’s AI tools, in accordance with TRC’s Privacy Policy.'
