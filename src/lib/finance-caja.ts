import type { FinanceCajaStage } from '@/types'

// State machine from brief F-01: Draft → Ready → Submitted → Under review →
// (Incidents ↔ Resubmitted) → Approved → Closed. Every transition here is
// meant to be logged as a finance_caja_events row by the caller.
const ALLOWED_TRANSITIONS: Record<FinanceCajaStage, FinanceCajaStage[]> = {
  draft: ['ready'],
  ready: ['submitted', 'draft'],
  submitted: ['under_review'],
  under_review: ['incidents', 'approved'],
  incidents: ['resubmitted'],
  resubmitted: ['under_review'],
  approved: ['closed'],
  closed: [],
}

export function canTransition(from: FinanceCajaStage, to: FinanceCajaStage): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}
