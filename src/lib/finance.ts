import type { FinanceAttachment, FinanceExpense, FinanceFunding, FinanceTransfer } from '@/types'

// ── Ticket conversion ──────────────────────────────────────────────────────
// A ticket's three figures must always agree: settlement_amount =
// local_amount ÷ exchange_rate_used, the rate being local units per 1
// settlement unit. They didn't (28 Oct 2026): a card-app screenshot showing
// "₸1,700 / $3.81" kept the receipt's dollar figure but the project's
// default rate (498.66 instead of the ~446 actually charged), so the ledger
// read "1,700 KZT @ 498.66 = $3.81" and the market-rate check judged a rate
// the money was never converted at. These helpers are the one rule used by
// the receipt reader, the upload and edit forms, and the logging and edit
// routes.

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

// The rate implied by a receipt that shows both amounts, to 9 significant
// digits — enough that converting back reproduces the settlement figure to
// the cent even for large amounts at rates near 1 (4 decimals drifted ~1.00 on
// 55,761 USD at 1.1152 per EUR).
export function rateFromAmounts(localAmount: number, settlementAmount: number): number {
  return Number((localAmount / settlementAmount).toPrecision(9))
}

export function isSameCurrency(localCurrency: string | null | undefined, settlementCurrency: string | null | undefined): boolean {
  const a = (localCurrency || '').trim().toUpperCase()
  return !!a && a === (settlementCurrency || '').trim().toUpperCase()
}

const positive = (n: unknown): number | null => {
  const v = typeof n === 'string' ? Number(n) : n
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

// Makes a ticket's rate and settlement amount consistent with its local
// amount. Server-side, so whatever a client sends is stored consistently:
//   - a receipt already in the settlement currency converts at exactly 1;
//   - with both a rate and a settlement amount that agree (to the cent), both
//     are kept;
//   - when they disagree, the settlement amount wins — it only ever differs
//     from local ÷ rate because it was read off the receipt (the amount
//     actually charged) — and the rate is derived from it;
//   - with only one of the two, the other is computed.
export function reconcileConversion(
  input: { localAmount: unknown; localCurrency: string | null | undefined; exchangeRate: unknown; settlementAmount: unknown },
  settlementCurrency: string,
): { exchangeRate: number; settlementAmount: number } | { error: string } {
  const local = positive(input.localAmount)
  if (local == null) return { error: 'The amount must be a positive number.' }
  if (isSameCurrency(input.localCurrency, settlementCurrency)) return { exchangeRate: 1, settlementAmount: roundMoney(local) }

  const rate = positive(input.exchangeRate)
  const settlement = positive(input.settlementAmount)
  if (rate != null && settlement != null) {
    if (Math.abs(roundMoney(local / rate) - settlement) <= 0.01) return { exchangeRate: rate, settlementAmount: roundMoney(settlement) }
    return { exchangeRate: rateFromAmounts(local, settlement), settlementAmount: roundMoney(settlement) }
  }
  if (settlement != null) return { exchangeRate: rateFromAmounts(local, settlement), settlementAmount: roundMoney(settlement) }
  if (rate != null) {
    const converted = roundMoney(local / rate)
    if (converted <= 0) return { error: `The amount converts to less than 0.01 ${settlementCurrency}.` }
    return { exchangeRate: rate, settlementAmount: converted }
  }
  return { error: 'Every expense needs a positive exchange rate.' }
}

// Funding evidence (migration 042, client request: "I can only upload one
// file as proof of a funds transfer"). Shared by the record and edit routes
// so both accept exactly the same thing: up to MAX_FUNDING_ATTACHMENTS files,
// every one inside the project's own storage folder. null = not a valid list.
export const MAX_FUNDING_ATTACHMENTS = 10

export function parseFundingAttachments(value: unknown, projectId: string): FinanceAttachment[] | null {
  if (!Array.isArray(value) || value.length > MAX_FUNDING_ATTACHMENTS) return null
  const files: FinanceAttachment[] = []
  for (const item of value) {
    const path = (item as { path?: unknown })?.path
    const name = (item as { name?: unknown })?.name
    if (typeof path !== 'string' || !path.startsWith(`${projectId}/`)) return null
    files.push({ path, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : 'Evidence' })
  }
  return files
}

// Balance = total funds received + transfers in − transfers out − verified
// spend only.
//
// Verified-only, per the client's updated requirement (reverses part of the
// "corrected model" migration 019 introduced, which counted pending spend
// too so the balance wouldn't look artificially healthy mid-week). Now an
// expense only draws down the balance once Finance has actually reviewed
// and verified it — pendingSpend is still returned below as an
// informational "awaiting review" figure, it just no longer subtracts from
// `balance`.
export function computeBalance(
  fundings: Pick<FinanceFunding, 'amount'>[],
  expenses: Pick<FinanceExpense, 'status' | 'settlement_amount'>[],
  transfersIn: Pick<FinanceTransfer, 'amount' | 'to_amount'>[] = [],
  transfersOut: Pick<FinanceTransfer, 'amount'>[] = [],
) {
  const totalFunded = fundings.reduce((sum, f) => sum + Number(f.amount), 0)
  // transfersIn arrives in the RECEIVING project's own currency (to_amount);
  // transfersOut leaves the SENDING project in its own currency (amount) —
  // this is what makes a cross-currency transfer correct on both sides'
  // independent ledgers. to_amount falls back to amount for any caller that
  // hasn't fetched it, since same-currency transfers have to_amount === amount.
  const totalTransfersIn = transfersIn.reduce((sum, t) => sum + Number(t.to_amount ?? t.amount), 0)
  const totalTransfersOut = transfersOut.reduce((sum, t) => sum + Number(t.amount), 0)
  const verifiedSpend = expenses
    .filter(e => e.status === 'verified')
    .reduce((sum, e) => sum + Number(e.settlement_amount), 0)
  const pendingSpend = expenses
    .filter(e => e.status === 'pending')
    .reduce((sum, e) => sum + Number(e.settlement_amount), 0)
  // What actually comes off the balance right now — verified only.
  const deductedSpend = verifiedSpend
  // Rounded to the cent: summed cents carry float noise (-0.0000000001
  // showed a red "-0.00" estimated balance when pending exactly used it up).
  return {
    totalFunded: roundMoney(totalFunded),
    totalTransfersIn: roundMoney(totalTransfersIn),
    totalTransfersOut: roundMoney(totalTransfersOut),
    verifiedSpend: roundMoney(verifiedSpend),
    pendingSpend: roundMoney(pendingSpend),
    deductedSpend: roundMoney(deductedSpend),
    balance: roundMoney(totalFunded + totalTransfersIn - totalTransfersOut - deductedSpend),
  }
}

// Verified-only, same reason as computeBalance above — keeping this in sync
// with the headline balance means the breakdown never implies more spend
// than what's actually been deducted.
export function spendByCategory(expenses: FinanceExpense[]) {
  const totals: Record<string, number> = {}
  for (const e of expenses) {
    if (e.status !== 'verified') continue
    totals[e.category] = (totals[e.category] || 0) + Number(e.settlement_amount)
  }
  return totals
}
