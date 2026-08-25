import type { FinanceExpense, FinanceFunding, FinanceTransfer } from '@/types'

// Balance = total funds received + transfers in − transfers out − every
// expense that ISN'T rejected (pending AND verified both count).
//
// This is the corrected model: an expense hits the balance the moment it's
// logged, not when Finance gets around to approving it — Finance reviews on
// their own weekly cadence, and showing the balance as if pending expenses
// hadn't happened yet would make it wrong for everyone else looking at the
// project in the meantime. Rejecting an expense is what reverses it (the
// rejected status is simply excluded here) — there's no separate "undo"
// step, the balance just recomputes.
export function computeBalance(
  fundings: Pick<FinanceFunding, 'amount'>[],
  expenses: Pick<FinanceExpense, 'status' | 'settlement_amount'>[],
  transfersIn: Pick<FinanceTransfer, 'amount'>[] = [],
  transfersOut: Pick<FinanceTransfer, 'amount'>[] = [],
) {
  const totalFunded = fundings.reduce((sum, f) => sum + Number(f.amount), 0)
  const totalTransfersIn = transfersIn.reduce((sum, t) => sum + Number(t.amount), 0)
  const totalTransfersOut = transfersOut.reduce((sum, t) => sum + Number(t.amount), 0)
  const verifiedSpend = expenses
    .filter(e => e.status === 'verified')
    .reduce((sum, e) => sum + Number(e.settlement_amount), 0)
  const pendingSpend = expenses
    .filter(e => e.status === 'pending')
    .reduce((sum, e) => sum + Number(e.settlement_amount), 0)
  // What actually comes off the balance right now — pending AND verified,
  // never rejected.
  const deductedSpend = verifiedSpend + pendingSpend
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

// Category breakdown counts pending + verified too, for the same reason —
// it's meant to reflect "what's actually happened," not just the subset
// Finance has gotten around to approving.
export function spendByCategory(expenses: FinanceExpense[]) {
  const totals: Record<string, number> = {}
  for (const e of expenses) {
    if (e.status === 'rejected') continue
    totals[e.category] = (totals[e.category] || 0) + Number(e.settlement_amount)
  }
  return totals
}
