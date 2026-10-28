import type { FinanceExpense, FinanceFunding } from '@/types'

// "Filter by the person who uploaded the receipt" (client request, Oct 2026)
// — shared by both ledgers. Keyed on logged_by, falling back to the
// snapshotted name when the account is gone (logged_by is SET NULL on delete).
export function uploaderKey(e: Pick<FinanceExpense, 'logged_by' | 'logged_by_name'>): string {
  return e.logged_by ?? `name:${e.logged_by_name}`
}

export function uploaderOptions(expenses: Pick<FinanceExpense, 'logged_by' | 'logged_by_name'>[]): { value: string; label: string }[] {
  const byKey = new Map<string, string>()
  for (const e of expenses) byKey.set(uploaderKey(e), e.logged_by_name || 'Unknown')
  return Array.from(byKey, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
}

// What one person's tickets add up to, by status — "who paid what".
export function uploaderTotals(expenses: Pick<FinanceExpense, 'status' | 'settlement_amount'>[]) {
  const totals = { count: expenses.length, verified: 0, pending: 0, rejected: 0 }
  for (const e of expenses) totals[e.status] += Number(e.settlement_amount)
  return totals
}

// "≈ $X if all pending tickets are approved" (client request, Oct 2026) —
// signed so an estimate that would overdraw the balance reads "−$12.00",
// not "$-12.00".
export function formatSignedAmount(symbol: string, amount: number): string {
  return `${amount < 0 ? '−' : ''}${symbol}${Math.abs(amount).toFixed(2)}`
}

// Shared by the admin project ledger and the field FieldExpensesSection so
// "sort by" means the same thing in both. `date` is when the money actually
// moved (an expense's receipt date, a funding's date sent); `uploadedAt` is
// when the row was recorded in the app; `pendingSince` is set only on a
// ticket still waiting for review.
export type LedgerSort = 'date_desc' | 'date_asc' | 'uploaded_desc' | 'waiting_desc'

export const LEDGER_SORT_OPTIONS: { value: LedgerSort; label: string }[] = [
  { value: 'date_desc', label: 'Expense date · newest first' },
  { value: 'date_asc', label: 'Expense date · oldest first' },
  { value: 'uploaded_desc', label: 'Date uploaded · newest first' },
  { value: 'waiting_desc', label: 'Waiting for review · longest first' },
]

export function compareLedgerRows(
  a: { date: string; uploadedAt: string; pendingSince?: string | null },
  b: { date: string; uploadedAt: string; pendingSince?: string | null },
  sort: LedgerSort,
): number {
  const uploaded = Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt)
  if (sort === 'uploaded_desc') return uploaded
  // Waiting tickets first, the longest-waiting at the top; everything else
  // after them, newest first.
  if (sort === 'waiting_desc') {
    if (a.pendingSince && b.pendingSince) return Date.parse(a.pendingSince) - Date.parse(b.pendingSince)
    if (a.pendingSince) return -1
    if (b.pendingSince) return 1
    return b.date.localeCompare(a.date) || uploaded
  }
  const byDate = a.date.localeCompare(b.date)
  if (byDate !== 0) return sort === 'date_asc' ? byDate : -byDate
  return uploaded
}

// "USD 1,000.00 at 0.92" — only when the funds were sent in a currency other
// than the project's own; null otherwise.
export function fundingConversionNote(f: Pick<FinanceFunding, 'sent_amount' | 'sent_currency' | 'exchange_rate'>, settlementCurrency: string): string | null {
  if (!f.sent_currency || f.sent_currency === settlementCurrency || f.sent_amount == null) return null
  return `${f.sent_currency} ${Number(f.sent_amount).toFixed(2)} at ${Number(f.exchange_rate)}`
}

// Whole days a ticket has been waiting for review since it was logged
// (client review, 26 Oct 2026: tickets had waited up to 49 days unseen).
export function waitingDays(loggedAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(loggedAt)) / 86400000))
}
