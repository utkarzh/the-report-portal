import type {
  SalesCoachKnowledgeKey,
  SalesCoachOutcome,
  SalesCoachReportCard,
  SalesCoachCriterion,
} from '@/types'

// The four negotiation outcomes the Sales Executive declares (US-036).
export const SALES_COACH_OUTCOMES: { value: SalesCoachOutcome; label: string }[] = [
  { value: 'signed', label: 'Signed on the spot' },
  { value: 'retorno', label: 'Retorno' },
  { value: 'lost', label: 'Lost' },
  { value: 'uncertain', label: 'Uncertain' },
]

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

// The eight Report Card criteria evaluated in tier 3 (US-039). Labels match the
// sample Report Card the client supplied.
export const SALES_COACH_CRITERIA: { key: string; label: string }[] = [
  { key: 'sales_offer_buildup', label: 'Sales Offer Build-up' },
  { key: 'offer_articulation', label: 'Offer Articulation' },
  { key: 'ceo_buyin', label: 'CEO Buy-in' },
  { key: 'ceo_preference', label: 'CEO Preference' },
  { key: 'space_price_retorno', label: 'Space & Price for Retorno' },
  { key: 'space_price_agreement', label: 'Space and Price Agreement' },
  { key: 'next_steps_stakeholders', label: 'Next Steps and Stakeholders' },
  { key: 'scheduled_meeting', label: 'Scheduled Meeting' },
]

// Recompute the Execution Score in code rather than trusting the model (US-039):
// a criterion counts toward the score only when scored === true (na/uv excluded,
// US-041), and a 'pass' earns the point. Returns the authoritative numbers.
export function recomputeScore(criteria: SalesCoachCriterion[]): { score: number; denominator: number } {
  const scored = criteria.filter((c) => c.scored && c.verdict !== 'na' && c.verdict !== 'uv')
  const denominator = scored.length
  const score = scored.filter((c) => c.verdict === 'pass').length
  return { score, denominator }
}

// Structural validation of the model's Report Card (US-039). We do NOT trust the
// model's own arithmetic or completeness — this recomputes the score, checks all
// criteria are present, and confirms exactly one coaching question. Returns the
// list of problems (empty = valid) so the route can trigger one corrective pass.
export function validateReportCard(rc: unknown): { ok: boolean; problems: string[]; normalized?: SalesCoachReportCard } {
  const problems: string[] = []
  if (!rc || typeof rc !== 'object') return { ok: false, problems: ['Report card is not an object'] }
  const card = rc as Partial<SalesCoachReportCard>

  if (!Array.isArray(card.criteria) || card.criteria.length === 0) {
    problems.push('Missing criteria array')
  }
  if (!card.summary?.trim()) problems.push('Missing summary')
  if (!card.assessed_position?.trim()) problems.push('Missing assessed_position')
  if (!card.coaching_question?.trim()) problems.push('Missing the single coaching question')

  // Every defined criterion must be present (by key).
  const present = new Set((card.criteria || []).map((c) => c.key))
  for (const { key, label } of SALES_COACH_CRITERIA) {
    if (!present.has(key)) problems.push(`Missing criterion: ${label}`)
  }

  if (problems.length > 0) return { ok: false, problems }

  // Recompute the score ourselves — overwrite whatever the model claimed.
  const { score, denominator } = recomputeScore(card.criteria as SalesCoachCriterion[])
  const normalized: SalesCoachReportCard = {
    company: card.company || '',
    declared_outcome: card.declared_outcome ?? null,
    assessed_position: card.assessed_position as SalesCoachReportCard['assessed_position'],
    execution_score: score,
    execution_denominator: denominator,
    summary: card.summary!,
    criteria: card.criteria as SalesCoachCriterion[],
    objections: Array.isArray(card.objections) ? card.objections : [],
    discrepancy: card.discrepancy ?? null,
    management_review: Boolean(card.management_review),
    coaching_question: card.coaching_question!,
  }
  return { ok: true, problems: [], normalized }
}

// The one-time privacy/data-use notice (US-047) — exact verbatim text.
export const SALES_COACH_PRIVACY_NOTICE =
  'Negotiation files and related data are securely retained by TRC and may be used internally for coaching, training, performance analysis and improvement of TRC’s AI tools, in accordance with TRC’s Privacy Policy.'
