import type { FinanceFunding } from '@/types'

// Shared by the admin project ledger and the field FieldExpensesSection so
// "sort by" means the same thing in both. `date` is when the money actually
// moved (an expense's receipt date, a funding's date sent); `uploadedAt` is
// when the row was recorded in the app.
export type LedgerSort = 'date_desc' | 'date_asc' | 'uploaded_desc'

export const LEDGER_SORT_OPTIONS: { value: LedgerSort; label: string }[] = [
  { value: 'date_desc', label: 'Expense date · newest first' },
  { value: 'date_asc', label: 'Expense date · oldest first' },
  { value: 'uploaded_desc', label: 'Date uploaded · newest first' },
]

export function compareLedgerRows(
  a: { date: string; uploadedAt: string },
  b: { date: string; uploadedAt: string },
  sort: LedgerSort,
): number {
  const uploaded = Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt)
  if (sort === 'uploaded_desc') return uploaded
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
