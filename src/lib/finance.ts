import type { FinanceExpense, FinanceFunding, FinanceTransfer } from '@/types'

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
  return {
    totalFunded,
    totalTransfersIn,
    totalTransfersOut,
    verifiedSpend,
    pendingSpend,
    deductedSpend,
    balance: totalFunded + totalTransfersIn - totalTransfersOut - deductedSpend,
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
