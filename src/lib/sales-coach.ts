import type {
  SalesCoachKnowledgeKey,
  SalesCoachOutcome,
  SalesCoachReportCard,
  SalesCoachCriterion,
  SalesCoachVerdict,
  SalesCoachAssessedPosition,
  SalesCoachNegotiation,
  SalesCoachStage,
  SalesCoachEvidence,
  SalesCoachObjection,
  SalesCoachAnalysisSection,
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

// The brief's qualifier-based AI-assessed commercial positions (US-040).
export const SALES_COACH_ASSESSED_POSITIONS: SalesCoachAssessedPosition[] = [
  'Positive/Won',
  'Apparent Positive/Won — confirmation required',
  'Controlled retorno',
  'Open retorno',
  'Open, low-confidence retorno',
  'Negative/Lost',
  'Uncertain — insufficient evidence',
  'Management review recommended',
]

// The nine Report Card criteria, in the fixed order of the client's sample
// card (US-039). `heading` is the upper-case section title used in the text
// rendering; `label` is the display name in the UI.
export const SALES_COACH_CRITERIA: { key: string; label: string; heading: string }[] = [
  { key: 'sales_offer_buildup', label: 'Sales Offer Build-up', heading: 'SALES OFFER BUILDUP' },
  { key: 'offer_articulation', label: 'Offer Articulation', heading: 'OFFER ARTICULATION' },
  { key: 'outcome', label: 'Outcome', heading: 'OUTCOME' },
  { key: 'ceo_buyin', label: 'CEO Buy-in', heading: 'CEO BUY-IN' },
  { key: 'ceo_preference', label: 'CEO Preference', heading: 'CEO PREFERENCE' },
  { key: 'space_price_retorno', label: 'Space & Price for Retorno', heading: 'SPACE & PRICE FOR RETORNO' },
  { key: 'space_price_agreement', label: 'Space and Price Agreement', heading: 'SPACE AND PRICE AGREEMENT' },
  { key: 'next_steps_stakeholders', label: 'Next Steps and Stakeholders', heading: 'NEXT STEPS AND STAKEHOLDERS' },
  { key: 'scheduled_meeting', label: 'Scheduled Meeting', heading: 'SCHEDULED MEETING' },
]

const CRITERION_KEYS = SALES_COACH_CRITERIA.map((c) => c.key)
const VERDICTS: SalesCoachVerdict[] = ['pass', 'warn', 'fail', 'na', 'uv']

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

export function verdictMark(v: SalesCoachVerdict): string {
  switch (v) {
    case 'pass': return '✅'
    case 'warn': return '⚠️'
    case 'fail': return '❌'
    case 'na': return 'N/A'
    case 'uv': return 'UV'
  }
}

// "Positive/Won" → "POSITIVE / WON" for the card's top line.
export function positionHeadline(p: string): string {
  return p.replace(/\s*\/\s*/g, ' / ').toUpperCase()
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
  ctx: { company: string; declaredOutcome: SalesCoachOutcome | null },
): { ok: boolean; problems: string[]; normalized?: SalesCoachReportCard } {
  const problems: string[] = []
  if (!rc || typeof rc !== 'object' || Array.isArray(rc)) {
    return { ok: false, problems: ['Report card is not a JSON object'] }
  }
  const card = rc as Record<string, unknown>

  const assessed = str(card.assessed_position)
  if (!SALES_COACH_ASSESSED_POSITIONS.includes(assessed as SalesCoachAssessedPosition)) {
    problems.push(`assessed_position must be one of: ${SALES_COACH_ASSESSED_POSITIONS.join(' | ')}`)
  }
  if (!str(card.headline)) problems.push('Missing headline')
  if (!str(card.summary)) problems.push('Missing summary')
  if (!str(card.report_summary)) problems.push('Missing report_summary')
  if (!str(card.coaching_question)) problems.push('Missing the single coaching question')
  if (typeof card.management_review !== 'boolean') problems.push('management_review must be true or false')

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
  for (const { key, label } of SALES_COACH_CRITERIA) {
    const c = byKey.get(key)
    if (!c) {
      problems.push(`Missing criterion: ${label}`)
      continue
    }
    const verdict = str(c.verdict)
    if (!VERDICTS.includes(verdict as SalesCoachVerdict)) {
      problems.push(`Criterion ${label}: verdict must be one of ${VERDICTS.join('/')}`)
    }
    if (!str(c.reason) && !str(c.note)) {
      problems.push(`Criterion ${label}: needs a reason (or a note for N/A)`)
    }
  }

  if (problems.length > 0) return { ok: false, problems }

  const criteria: SalesCoachCriterion[] = SALES_COACH_CRITERIA.map(({ key, label }) => {
    const c = byKey.get(key)!
    const verdict = str(c.verdict) as SalesCoachVerdict
    return {
      key,
      label,
      verdict,
      note: str(c.note) || undefined,
      evidence: cleanEvidence(c.evidence),
      reason: str(c.reason) || undefined,
      scored: isScoredVerdict(verdict),
    }
  })

  const { score, denominator } = recomputeScore(criteria)
  const discrepancy = str(card.discrepancy) || null

  const normalized: SalesCoachReportCard = {
    company: ctx.company,
    declared_outcome: ctx.declaredOutcome,
    assessed_position: assessed as SalesCoachAssessedPosition,
    headline: str(card.headline),
    execution_score: score,
    execution_denominator: denominator,
    summary: str(card.summary),
    criteria,
    report_summary: str(card.report_summary),
    objections: cleanObjections(card.objections),
    deeper_analysis: cleanSections(card.deeper_analysis),
    discrepancy,
    management_review: Boolean(card.management_review),
    coaching_question: str(card.coaching_question),
  }
  return { ok: true, problems: [], normalized }
}

// Code-level backstop for the declared-vs-assessed distinction (US-040): a
// material mismatch always raises the management-review flag, whatever the
// model decided. Returns the (possibly) updated card.
export function applyDiscrepancyRules(card: SalesCoachReportCard): SalesCoachReportCard {
  const declared = card.declared_outcome
  const assessed = card.assessed_position
  let mismatch: string | null = null

  if (declared === 'signed' && assessed !== 'Positive/Won') {
    mismatch = `Declared "Signed on the spot" but the transcript supports "${assessed}".`
  } else if (declared === 'lost' && (assessed === 'Positive/Won' || assessed === 'Apparent Positive/Won — confirmation required')) {
    mismatch = `Declared "Lost" but the transcript supports "${assessed}".`
  } else if (declared === 'retorno' && (assessed === 'Positive/Won' || assessed === 'Negative/Lost')) {
    mismatch = `Declared "Retorno" but the transcript supports "${assessed}".`
  }

  if (!mismatch && assessed !== 'Management review recommended') return card
  return {
    ...card,
    discrepancy: card.discrepancy || mismatch,
    management_review: true,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Text rendering — the layout of the client's sample Report Card, as markdown.
// Derived from the structured card so the text and the UI can never disagree.
// ────────────────────────────────────────────────────────────────────────────

export function renderReportCardMarkdown(card: SalesCoachReportCard): string {
  const lines: string[] = []
  const scoreText = `${formatScore(card.execution_score, card.execution_denominator)} applicable points`
  lines.push('# REPORT CARD')
  lines.push(`**${positionHeadline(card.assessed_position)} — ${scoreText} — ${card.headline}**`)
  lines.push('')
  lines.push(card.summary)
  lines.push('')

  card.criteria.forEach((c, i) => {
    const meta = SALES_COACH_CRITERIA.find((k) => k.key === c.key)
    lines.push(`## ${i + 1}. ${meta?.heading || c.label.toUpperCase()}`)
    if (c.key === 'outcome' && isScoredVerdict(c.verdict)) {
      lines.push(`**${positionHeadline(card.assessed_position)}${c.note ? ` — ${c.note}` : ''}**`)
    } else if (c.verdict === 'na') {
      lines.push(`**N/A${c.note ? ` — ${c.note}` : ''}**`)
    } else if (c.verdict === 'uv') {
      lines.push(`**UV — audio verification required${c.note ? ` — ${c.note}` : ''}**`)
    } else {
      lines.push(`**${verdictMark(c.verdict)}${c.note ? ` — ${c.note}` : ''}**`)
    }
    for (const e of c.evidence || []) lines.push(`**${e.label}:** ${e.text}`)
    if (c.reason) lines.push(`**Reason:** ${c.reason}`)
    lines.push('')
  })

  lines.push('## SCORELINE')
  lines.push(`**Execution Score:** ${formatScore(card.execution_score, card.execution_denominator).replace('/', ' / ')} applicable points`)
  lines.push(`**Commercial Outcome:** ${card.assessed_position}`)
  if (card.discrepancy) lines.push(`**Declared vs assessed:** ${card.discrepancy}`)
  if (card.management_review) lines.push('**Management review:** Recommended')
  lines.push(`**Report Summary:** ${card.report_summary}`)
  lines.push('')

  lines.push('# DEEPER ANALYSIS AND FEEDBACK')
  if (card.objections.length > 0) {
    lines.push('## OBJECTIONS & HANDLING')
    card.objections.forEach((o, i) => {
      if (card.objections.length > 1) lines.push(`**${i + 1}.**`)
      lines.push(`**Objection/Hesitation:** ${o.objection}`)
      lines.push(`**How the representative handled it:** ${o.handled}`)
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
    assessed_position: {
      type: 'string',
      enum: SALES_COACH_ASSESSED_POSITIONS,
      description: 'The AI-assessed commercial position, judged from the transcript evidence — NOT the declared outcome.',
    },
    headline: {
      type: 'string',
      description: 'One sentence: what was secured (space/price) and the single most important execution note.',
    },
    summary: {
      type: 'string',
      description: 'The opening paragraph: what the representative did across the negotiation and the main improvement for next time. 3-5 sentences.',
    },
    criteria: {
      type: 'array',
      description: 'Exactly the nine criteria, in order, each exactly once.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: CRITERION_KEYS },
          verdict: { type: 'string', enum: VERDICTS },
          note: {
            type: 'string',
            description: 'Short text after the verdict mark. For OUTCOME: the space and price (e.g. "Half page, USD 30,000"). For N/A: why it does not apply (e.g. "outcome is Positive/Won"). Empty string otherwise.',
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
          handled: { type: 'string', description: 'How the representative actually handled it.' },
          original_wording: { type: 'string', description: 'What the representative said, verbatim. Empty if not applicable.' },
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
    discrepancy: {
      type: 'string',
      description: 'If the declared outcome and the assessed position differ: one sentence explaining the gap. Empty string if they agree.',
    },
    management_review: {
      type: 'boolean',
      description: 'true when the declared-vs-assessed discrepancy is material, evidence is contradictory, or the negotiation needs a manager to look at it.',
    },
    coaching_question: {
      type: 'string',
      description: 'Exactly ONE focused coaching question for the representative, tied to the decisive moment.',
    },
  },
  required: [
    'assessed_position', 'headline', 'summary', 'criteria', 'report_summary',
    'objections', 'deeper_analysis', 'discrepancy', 'management_review', 'coaching_question',
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

CRITERIA — exactly these nine, in this order, each exactly once:
1. sales_offer_buildup — did the rep build a personalised planteo from the interview (the CEO's own messages), connect those messages to a dedicated space, and move into the offer?
2. offer_articulation — was a complete offer stated: space/format, principal benefits, level of investment, then a leading/closing question? Two options at most, largest first.
3. outcome — the commercial result AS EVIDENCED IN THE TRANSCRIPT. Its verdict mirrors assessed_position: pass for Positive/Won; warn for "Apparent Positive/Won — confirmation required" or "Controlled retorno"; fail for "Open retorno", "Open, low-confidence retorno" or "Negative/Lost"; uv for "Uncertain — insufficient evidence". Put the specific space and price in note.
4. ceo_buyin — did the CEO personally and explicitly confirm they want the company to participate, before implementation, delegation or retorno?
5. ceo_preference — did the CEO state (not have assumed) a clear preference for a specific space/option?
6. space_price_retorno — ONLY when the negotiation ended in a retorno: was a specific space and price carried into the follow-up? na when signed on the spot or lost outright.
7. space_price_agreement — were the specific space, price and payment condition explicitly worked through and acknowledged by both sides? na when nothing was agreed.
8. next_steps_stakeholders — were next steps, ownership and any further stakeholder (who approves, who signs, who handles production) clearly established under the CEO's direction? Implementation delegation after the decision is fine; commercial delegation before it is not.
9. scheduled_meeting — when a retorno or further decision meeting was needed: was it fixed with a date and time? na when signed on the spot and only production coordination remains.

VERDICTS: pass = fully met per TRC doctrine. warn = partly met / an execution gap that did not cost the deal. fail = not met. na = does not apply on this outcome path (say why in note). uv = the transcript genuinely cannot show it and the audio would need to be checked (use sparingly). Apply the judgement thresholds from the Project Prompt where it defines them; otherwise use the Manual and Method. Never award pass on assumption — the rep must make the buyer SAY it.

SCORE ARITHMETIC (recomputed in code — do not compute it yourself): pass = 1 point, warn = 0.5, fail = 0; na and uv are excluded from the applicable total.

EVIDENCE RULES: every pass/warn/fail must cite verbatim transcript evidence in evidence[] (labels: "Quote", "Offer quoted", "Leading question quoted", "Subsequent conduct", or similar). Quote exactly as transcribed, in the transcript's language, wrapped in double quotes; add a short English gloss in brackets if the quote is not in English. NEVER invent, paraphrase into quotes, or borrow dialogue from the Examples document. If no quote exists, say so in reason.

DECLARED vs ASSESSED (US-040): the declared outcome and outcome_details are the executive's account. assessed_position is your judgement from the transcript. Physical or off-audio events the executive declared (e.g. an agreement signed) are factual metadata — accept them unless the transcript materially contradicts them. When they differ, explain in discrepancy and set management_review true if the difference is material. Never collapse the two.

STYLE (TRC coaching method): recognise the genuine strengths first, with evidence; then be direct about the decisive moment and its commercial consequence; show the exact words the rep could have used, short enough to say to a CEO and ending in a question; natural professional language, no generic sales jargon, no motivational padding. The Examples document is for pattern recognition only — never import its facts, numbers or dialogue. Write in English.

OBJECTIONS: list every real objection or hesitation the buyer raised, how the rep handled it, the rep's original wording, the TRC-doctrine alternative, and the principle it comes from. If the rep handled it correctly, say so and leave the alternative empty.

deeper_analysis: 0-3 sections only when they add something (e.g. CONCISE CONFIRMATION APPLICATION, RETORNO CONTROL, TEAM CHOREOGRAPHY). coaching_question: exactly one, tied to the decisive moment.`

// The one-time privacy/data-use notice (US-047) — exact verbatim text.
export const SALES_COACH_PRIVACY_NOTICE =
  'Negotiation files and related data are securely retained by TRC and may be used internally for coaching, training, performance analysis and improvement of TRC’s AI tools, in accordance with TRC’s Privacy Policy.'
