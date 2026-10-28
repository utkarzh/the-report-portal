import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseCategory, FinanceFlagSeverity, FinanceProject } from '@/types'
import { checkRate, formatRate, isGrossRateError, rateGap } from '@/lib/fx-check'

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

// No single field ticket comes near this (largest real one on 26 Oct 2026:
// ~2,039 for a 15-night apartment) — above it, the conversion is almost
// certainly wrong. In the project's settlement currency.
export const IMPLAUSIBLE_TICKET_AMOUNT = 20000
// …or, as a warning only, this many times the project's typical (median)
// ticket AND at least OUTLIER_FLOOR, once it has enough tickets for
// "typical" to mean something. The floor matters: on a project of $3 taxis a
// genuine $106 dinner is 30× the median (seen on Kazakhstan, 26 Oct 2026).
const OUTLIER_MULTIPLE = 50
const OUTLIER_FLOOR = 1000
const OUTLIER_MIN_TICKETS = 5

export interface FlagInput {
  category: FinanceExpenseCategory
  expenseDate: string
  vendor: string | null
  reference: string | null
  localAmount: number
  localCurrency: string
  settlementAmount: number
  exchangeRateUsed: number
  nights: number | null
  loggedBy: string | null
}

export interface FlagContext {
  // Today's market rate for local currency per 1 settlement unit
  // (lib/fx-rates.ts), null when no reference was reachable.
  marketRate?: number | null
  // Everything the project has received so far (funds + transfers in).
  fundsReceived?: number
}

export function computeDeterministicFlags(
  input: FlagInput,
  project: Pick<FinanceProject, 'country' | 'exchange_rate' | 'settlement_currency'>,
  existingExpenses: FinanceExpense[],
  context: FlagContext = {},
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

  flags.push(...conversionFlags(input, project, existingExpenses, context))

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

// The two checks on how a ticket was converted — re-run on their own after
// an edit or a re-conversion (see refreshConversionFlags in finance-review.ts).
//
// Currency: the rate is compared with today's market rate when one is
// available — not the project's own rate, which is exactly what let
// Jamaica's inverted 0.0063 through (each ticket matched the wrong project
// rate) — falling back to the project rate otherwise. A receipt already in
// the settlement currency should be at rate 1. A rate the wrong way round is
// critical: it multiplies or divides every amount by the rate squared.
//
// Amount: a ticket worth more than everything the project has received, more
// than IMPLAUSIBLE_TICKET_AMOUNT, or far above the project's usual ticket.
export function conversionFlags(
  input: Pick<FlagInput, 'localAmount' | 'localCurrency' | 'settlementAmount' | 'exchangeRateUsed'>,
  project: Pick<FinanceProject, 'exchange_rate' | 'settlement_currency'>,
  existingExpenses: Pick<FinanceExpense, 'status' | 'settlement_amount'>[],
  context: FlagContext = {},
): NewFlag[] {
  const flags: NewFlag[] = []
  const settlement = project.settlement_currency
  const local = (input.localCurrency || '').toUpperCase()

  const sameCurrency = local === settlement
  // Judge the rate the money was actually converted at (local ÷ settlement),
  // not only the stored rate: a ticket logged before 28 Oct 2026 could carry
  // the receipt's own dollar figure beside the project's default rate, and
  // checking the label would pass a conversion that never happened. Below
  // 0.50 the cent rounding makes the implied rate meaningless (3 KZT = 0.01).
  const effectiveRate = input.localAmount > 0 && input.settlementAmount >= 0.5
    ? input.localAmount / input.settlementAmount
    : input.exchangeRateUsed
  const reference = sameCurrency ? 1 : (context.marketRate ?? Number(project.exchange_rate))
  const referenceLabel = sameCurrency
    ? `1 (the receipt is already in ${settlement})`
    : context.marketRate
      ? `today's market rate, 1 ${settlement} ≈ ${formatRate(reference)} ${local}`
      : `the project's rate, ${formatRate(reference)} ${local || 'local'} per ${settlement}`
  if (reference > 0 && effectiveRate > 0) {
    const { verdict } = checkRate(effectiveRate, reference)
    if (verdict === 'inverted') {
      flags.push({
        flagType: 'currency_anomaly',
        severity: 'crit',
        message: `The exchange rate (${formatRate(effectiveRate)}) looks the wrong way round — expected about ${referenceLabel}. It should be ${local || 'local'} per 1 ${settlement}.`,
      })
    } else if (verdict === 'off') {
      // 10× or more off is a wrong rate, not a bureau difference — critical.
      const gross = isGrossRateError(effectiveRate, reference)
      flags.push({
        flagType: 'currency_anomaly',
        severity: gross ? 'crit' : 'warn',
        message: `Exchange rate used (${formatRate(effectiveRate)}) is ${rateGap(effectiveRate, reference)} than ${referenceLabel}.${gross ? ' The converted amount is almost certainly wrong.' : ''}`,
      })
    }
  }

  const amount = Number(input.settlementAmount)
  const others = existingExpenses.filter(e => e.status !== 'rejected').map(e => Number(e.settlement_amount)).sort((a, b) => a - b)
  const median = others.length >= OUTLIER_MIN_TICKETS ? others[Math.floor(others.length / 2)] : null
  const funds = context.fundsReceived ?? 0
  const critical = amount >= IMPLAUSIBLE_TICKET_AMOUNT
    ? `over ${IMPLAUSIBLE_TICKET_AMOUNT.toLocaleString('en-US')} ${settlement} for one ticket`
    : funds > 0 && amount > funds
      ? `more than everything the project has received (${funds.toFixed(2)} ${settlement})`
      : null
  const outlier = !critical && median && median > 0 && amount >= OUTLIER_FLOOR && amount > median * OUTLIER_MULTIPLE
    ? `over ${OUTLIER_MULTIPLE}× the project's typical ticket (${median.toFixed(2)} ${settlement})`
    : null
  if (critical || outlier) {
    flags.push({
      flagType: 'implausible_amount',
      severity: critical ? 'crit' : 'warn',
      message: `Converted amount ${amount.toFixed(2)} ${settlement} is ${critical || outlier} — check the amount and the exchange rate.`,
    })
  }
  return flags
}

// Category ↔ description sanity check — deterministic, zero-cost (no AI
// call), same spirit as the other checks above. Not exhaustive: it only
// catches a clear-cut mismatch (a taxi ride logged as Communications) via a
// small keyword list per category, rather than trying to classify every
// expense. `other_services` is deliberately keyword-free — it's a catch-all
// category, nothing else's keywords should contradict landing there.
const CATEGORY_KEYWORDS: Record<FinanceExpenseCategory, string[]> = {
  transport: ['taxi', 'uber', 'cab ', 'ride-hailing', 'ride hailing', 'flight', 'airline', 'airfare', 'train', 'railway', 'bus ticket', 'metro', 'fuel', 'petrol', 'gas station', 'parking', 'toll', 'car rental'],
  accommodation: ['hotel', 'hostel', 'motel', 'airbnb', 'lodging', 'resort', 'guesthouse', 'night stay'],
  communications: ['sim card', 'data plan', 'internet', 'wifi', 'wi-fi', 'phone bill', 'mobile top', 'airtime', 'roaming', 'phone credit'],
  printing_office: ['printing', 'photocopy', 'photocopying', 'stationery', 'office supplies', 'ink cartridge'],
  bank_charges: ['bank fee', 'wire fee', 'transfer fee', 'atm fee', 'withdrawal fee', 'bank commission'],
  other_services: [],
}

export function categoryMismatchFlag(category: FinanceExpenseCategory, concept: string, vendor: string | null): NewFlag[] {
  const text = `${concept} ${vendor || ''}`.toLowerCase()
  for (const [otherCategory, keywords] of Object.entries(CATEGORY_KEYWORDS) as [FinanceExpenseCategory, string[]][]) {
    if (otherCategory === category) continue
    const hit = keywords.find(k => text.includes(k))
    if (hit) {
      return [{
        flagType: 'category_mismatch',
        severity: 'warn',
        message: `"${hit.trim()}" in the description usually means ${FINANCE_EXPENSE_CATEGORY_LABELS[otherCategory]}, not ${FINANCE_EXPENSE_CATEGORY_LABELS[category]} — double check the category.`,
      }]
    }
  }
  return []
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
