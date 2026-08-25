'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import Button from '@/components/ui/Button'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseFlag } from '@/types'
import ExpenseDetailModal from '@/components/finance/ExpenseDetailModal'

type ExpenseWithReceipt = FinanceExpense & { receiptUrl: string | null; finance_expense_flags?: FinanceExpenseFlag[] }

interface Props {
  settlementCurrency: string
  rejectedExpenses: ExpenseWithReceipt[]
}

// Full-width section listing rejected expenses with "fix & resubmit" /
// "withdraw" (brief D-06). Deliberately its own component (not part of the
// button row in FieldProjectActions) so it always renders full-width below
// the header, regardless of where that row's flex layout puts things.
export default function NeedsAttentionSection({ settlementCurrency, rejectedExpenses }: Props) {
  const router = useRouter()
  const [reuploadTarget, setReuploadTarget] = useState<ExpenseWithReceipt | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [detailExpense, setDetailExpense] = useState<ExpenseWithReceipt | null>(null)
  const symbol = settlementCurrency === 'USD' ? '$' : '€'

  function refresh() {
    router.refresh()
  }

  function toggleNote(expenseId: string) {
    setExpandedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(expenseId)) next.delete(expenseId)
      else next.add(expenseId)
      return next
    })
  }

  async function handleWithdraw(id: string) {
    setBusyId(id)
    await fetch(`/api/finance/expenses/${id}`, { method: 'DELETE' })
    setBusyId(null)
    refresh()
  }

  if (rejectedExpenses.length === 0) return null

  return (
    <div className="mt-8 mb-8">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={14} className="text-red-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Needs your attention</span>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">
          {rejectedExpenses.length}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {rejectedExpenses.map(e => (
          <div
            key={e.id}
            onClick={() => setDetailExpense(e)}
            className="bg-white border border-red-200 rounded-xl overflow-hidden cursor-pointer hover:border-red-300 transition-colors"
          >
            <div className="p-4 flex gap-3">
              {e.receiptUrl && (
                <a href={e.receiptUrl} target="_blank" rel="noopener noreferrer" onClick={ev => ev.stopPropagation()} className="flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={e.receiptUrl}
                    alt="Receipt"
                    className="w-14 h-14 rounded-lg object-cover border border-red-200 bg-gray-50 hover:opacity-80 transition-opacity"
                  />
                </a>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="text-sm font-semibold text-gray-900 truncate">{e.concept}</div>
                  <div className="text-sm font-semibold tabular-nums text-gray-900 flex-shrink-0">
                    {settlementCurrency} {e.settlement_amount.toFixed(2)}
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {e.expense_date} · {FINANCE_EXPENSE_CATEGORY_LABELS[e.category]}
                </div>
                {e.ai_note && (
                  <div className="mt-1.5" onClick={ev => ev.stopPropagation()}>
                    <button
                      onClick={() => toggleNote(e.id)}
                      className="inline-flex items-center gap-1 text-[10.5px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5 hover:bg-blue-100 transition-colors"
                    >
                      <Sparkles size={10} /> AI review
                      {expandedNotes.has(e.id) ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    </button>
                    {expandedNotes.has(e.id) && (
                      <div className="text-xs text-blue-700 italic mt-1.5 max-w-md">{e.ai_note}</div>
                    )}
                  </div>
                )}
                {(e.finance_expense_flags ?? []).filter(f => !f.resolved).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(e.finance_expense_flags ?? []).filter(f => !f.resolved).map(f => (
                      <span
                        key={f.id}
                        className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded ${
                          f.severity === 'crit' ? 'bg-red-50 text-red-700' : f.severity === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {f.message}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2.5 bg-red-50 rounded-lg px-3 py-2 text-xs text-red-800">
                  <span className="font-semibold">Rejected: </span>
                  {e.rejection_reason}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-2.5 border-t border-red-100 bg-red-50/40" onClick={ev => ev.stopPropagation()}>
              <button
                onClick={() => setReuploadTarget(e)}
                className="text-xs font-medium border border-[#e5e3df] bg-white rounded-lg px-3 py-1.5 hover:bg-gray-50"
              >
                Fix &amp; resubmit
              </button>
              <button
                onClick={() => handleWithdraw(e.id)}
                disabled={busyId === e.id}
                className="text-xs font-medium text-red-600 border border-red-200 bg-white rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
              >
                Withdraw
              </button>
            </div>
          </div>
        ))}
      </div>

      {reuploadTarget && (
        <FixExpenseModal
          expense={reuploadTarget}
          settlementCurrency={settlementCurrency}
          onClose={() => setReuploadTarget(null)}
          onSaved={refresh}
        />
      )}
      {detailExpense && (
        <ExpenseDetailModal expense={detailExpense} symbol={symbol} onClose={() => setDetailExpense(null)} />
      )}
    </div>
  )
}

// Lightweight inline edit for the "Fix & resubmit" flow — reuses the same
// fields as the upload confirm step but against an already-logged, rejected
// expense (brief D-06: "correct the data or replace the image and resubmit").
function FixExpenseModal({ expense, settlementCurrency, onClose, onSaved }: {
  expense: FinanceExpense
  settlementCurrency: string
  onClose: () => void
  onSaved: () => void
}) {
  const [concept, setConcept] = useState(expense.concept)
  const [localAmount, setLocalAmount] = useState(String(expense.local_amount))
  const [date, setDate] = useState(expense.expense_date)
  const [vendor, setVendor] = useState(expense.vendor || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setLoading(true)
    setError(null)
    const amt = parseFloat(localAmount)
    const settlementAmount = Number.isFinite(amt) ? Math.round((amt / expense.exchange_rate_used) * 100) / 100 : expense.settlement_amount
    const res = await fetch(`/api/finance/expenses/${expense.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concept, localAmount: amt, date, vendor, settlementAmount }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to resubmit.')
      setLoading(false)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-sm shadow-2xl rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-4">Fix &amp; resubmit</h3>
        {error && <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded">{error}</div>}
        <div className="flex flex-col gap-3">
          <input className="text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={concept} onChange={e => setConcept(e.target.value)} placeholder="Concept" />
          <input type="date" className="text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={date} onChange={e => setDate(e.target.value)} />
          <input className="text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor" />
          <input type="number" step="0.01" className="text-sm border border-[#e5e3df] rounded-lg px-3 py-2 tabular-nums" value={localAmount} onChange={e => setLocalAmount(e.target.value)} placeholder={`Local amount (${expense.local_currency})`} />
          <p className="text-[11px] text-gray-500">Converted at the project's rate to {settlementCurrency} on save.</p>
          <div className="flex gap-3 pt-1">
            <Button size="sm" loading={loading} onClick={handleSave}>Resubmit</Button>
            <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}
