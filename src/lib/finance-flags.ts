import type { FinanceExpense, FinanceExpenseCategory, FinanceFlagSeverity, FinanceProject } from '@/types'

export interface NewFlag {
  flagType: string
  severity: FinanceFlagSeverity
  message: string
}

// Per-country weekend days (0=Sun..6=Sat). Defaults to Sat/Sun; a small,
// clearly-documented set of known exceptions. This is informational (never
// blocks logging) — it exists so Finance can ask "why does this fall on a
// non-working day" rather than to police it automatically (brief E-02).
const WEEKEND_OVERRIDES: Record<string, number[]> = {
  india: [0],
  'saudi arabia': [5, 6],
  uae: [5, 6],
  'united arab emirates': [5, 6],
  israel: [5, 6],
  qatar: [5, 6],
}
const DEFAULT_WEEKEND = [0, 6]

function weekendDaysFor(country: string): number[] {
  return WEEKEND_OVERRIDES[country.trim().toLowerCase()] ?? DEFAULT_WEEKEND
}

const EXCHANGE_RATE_ANOMALY_TOLERANCE = 0.15 // 15%

export interface FlagInput {
  category: FinanceExpenseCategory
  expenseDate: string
  vendor: string | null
  reference: string | null
  localAmount: number
  settlementAmount: number
  exchangeRateUsed: number
  nights: number | null
  loggedBy: string | null
}

export function computeDeterministicFlags(
  input: FlagInput,
  project: Pick<FinanceProject, 'country' | 'exchange_rate'>,
  existingExpenses: FinanceExpense[],
): NewFlag[] {
  const flags: NewFlag[] = []

  // Duplicate — same amount + date + supplier, OR same amount + reference
  // code (client's consultant guide §6.3: "same amount + same date + same
  // supplier" OR "similar description or same reference code"). Amount is
  // required on the reference match too: a single multi-line invoice (e.g.
  // one hotel folio) is logged as one entry now, but if it ever produces
  // several entries sharing that invoice's reference number, they're
  // legitimately different amounts, not duplicates.
  const duplicate = existingExpenses.find(e => {
    const sameAmount = Number(e.local_amount) === input.localAmount
    const sameAmountDateVendor = sameAmount
      && e.expense_date === input.expenseDate
      && (e.vendor || '').trim().toLowerCase() === (input.vendor || '').trim().toLowerCase()
      && (input.vendor || '').trim() !== ''
    const sameAmountReference = sameAmount
      && !!input.reference?.trim()
      && (e.reference || '').trim().toLowerCase() === input.reference.trim().toLowerCase()
    return sameAmountDateVendor || sameAmountReference
  })
  if (duplicate) {
    flags.push({
      flagType: 'duplicate',
      severity: 'crit',
      message: `Possible duplicate — same amount & vendor as an expense already logged on ${duplicate.expense_date}${duplicate.logged_by_name ? ` by ${duplicate.logged_by_name}` : ''}. Verify both are real.`,
    })
  }

  // Weekend date — per-country working pattern (info only).
  const weekendDays = weekendDaysFor(project.country)
  const dow = new Date(input.expenseDate + 'T00:00:00Z').getUTCDay()
  if (weekendDays.includes(dow)) {
    flags.push({
      flagType: 'weekend',
      severity: 'info',
      message: `Falls on a non-working day for ${project.country} — check justification.`,
    })
  }

  // Currency anomaly — the rate used deviates significantly from the
  // project's configured rate.
  if (project.exchange_rate && input.exchangeRateUsed) {
    const deviation = Math.abs(input.exchangeRateUsed - project.exchange_rate) / project.exchange_rate
    if (deviation > EXCHANGE_RATE_ANOMALY_TOLERANCE) {
      flags.push({
        flagType: 'currency_anomaly',
        severity: 'warn',
        message: `Exchange rate used (${input.exchangeRateUsed}) differs by more than ${Math.round(EXCHANGE_RATE_ANOMALY_TOLERANCE * 100)}% from the project's configured rate (${project.exchange_rate}).`,
      })
    }
  }

  // Prior-approval-required category (brief rule #9).
  if (input.category === 'other_services') {
    flags.push({
      flagType: 'prior_approval_required',
      severity: 'crit',
      message: '"Other Professional Services" (PR, interpreters, couriers) must be signed off before reimbursement. No approval on file.',
    })
  }

  return flags
}

export function missingFieldFlags(lowConfidenceFields: string[]): NewFlag[] {
  if (lowConfidenceFields.length === 0) return []
  return [{
    flagType: 'missing_illegible',
    severity: 'warn',
    message: `Low confidence on: ${lowConfidenceFields.join(', ')}. Poor transcription/photo quality is a data limitation, not evidence against the expense.`,
  }]
}

export function suspiciousPersonalFlag(suspiciousPersonal: boolean, aiComment: string): NewFlag[] {
  if (!suspiciousPersonal) return []
  return [{
    flagType: 'suspicious_personal',
    severity: 'warn',
    message: aiComment || 'This looks like it may be a personal, non-business purchase — please verify.',
  }]
}
