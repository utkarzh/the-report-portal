'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Search, Receipt, Sparkles, ChevronDown, ChevronUp, ChevronRight, Layers, Car, BedDouble, Phone, Printer, Landmark, X, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseCategory, FinanceExpenseFlag, FinanceFunding, FinanceTransfer } from '@/types'
import ExpenseDetailModal from '@/components/finance/ExpenseDetailModal'

type StatusFilter = 'all' | 'pending' | 'verified' | 'rejected'
type TypeFilter = 'all' | 'expense' | 'funding' | 'transfer'
type ExpenseWithReceipt = FinanceExpense & { receiptUrl: string | null; finance_expense_flags?: FinanceExpenseFlag[] }
type FundingRow = FinanceFunding & { profiles: { full_name: string | null; email: string } | null }

type LedgerRow =
  | { kind: 'funding'; date: string; label: string; amountIn: number; sortKey: number }
  | { kind: 'transfer_in'; date: string; label: string; amountIn: number; sortKey: number }
  | { kind: 'transfer_out'; date: string; label: string; amountOut: number; sortKey: number }
  | { kind: 'expense'; date: string; expense: ExpenseWithReceipt; amountOut: number; countsInBalance: boolean; sortKey: number }

// Same icon set as admin's SpendByCategoryModal (admin/projects/[id]/page.tsx)
// — kept in sync so a category means the same picture everywhere.
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  transport: Car,
  accommodation: BedDouble,
  communications: Phone,
  other_services: Layers,
  printing_office: Printer,
  bank_charges: Landmark,
}

interface Props {
  expenses: ExpenseWithReceipt[]
  fundings: FundingRow[]
  transfersIn: FinanceTransfer[]
  transfersOut: FinanceTransfer[]
  categorySpend: Record<string, number>
  currencySymbol: string
}

// A field user's history used to be expenses only — funding sent by admin
// (and any project-to-project transfers) never showed up here even though
// admin's own project page shows all of it in one ledger. That's the same
// asymmetry we already fixed for receipts and the AI-review pill: whatever
// admin can see about a project, the field team on it should see too. So
// this merges expenses + fundings + transfers into one ledger, same as
// admin/projects/[id]/page.tsx, with a type filter alongside the existing
// status/category ones (which only apply to expense rows, same as admin).
export default function FieldExpensesSection({ expenses, fundings, transfersIn, transfersOut, categorySpend, currencySymbol }: Props) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [category, setCategory] = useState<FinanceExpenseCategory | 'all'>('all')
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [detailExpense, setDetailExpense] = useState<ExpenseWithReceipt | null>(null)

  const totalCategorySpend = Object.values(categorySpend).reduce((sum, v) => sum + (v || 0), 0)
  const topCategory = Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS)
    .map(([key, label]) => ({ key, label, amount: categorySpend[key] || 0 }))
    .sort((a, b) => b.amount - a.amount)[0]

  function toggleNote(expenseId: string) {
    setExpandedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(expenseId)) next.delete(expenseId)
      else next.add(expenseId)
      return next
    })
  }

  const ledgerRows: LedgerRow[] = useMemo(() => [
    ...fundings.map(f => ({
      kind: 'funding' as const,
      date: f.date_sent,
      label: `Funds received${f.profiles ? ` · sent by ${f.profiles.full_name || f.profiles.email}` : ''}`,
      amountIn: Number(f.amount),
      sortKey: new Date(f.date_sent).getTime(),
    })),
    ...transfersIn.map(t => ({
      kind: 'transfer_in' as const,
      date: t.created_at.slice(0, 10),
      label: `Transfer in${t.reason ? ` — ${t.reason}` : ''}`,
      amountIn: Number(t.amount),
      sortKey: new Date(t.created_at).getTime(),
    })),
    ...transfersOut.map(t => ({
      kind: 'transfer_out' as const,
      date: t.created_at.slice(0, 10),
      label: `Transfer out${t.reason ? ` — ${t.reason}` : ''}`,
      amountOut: Number(t.amount),
      sortKey: new Date(t.created_at).getTime(),
    })),
    ...expenses.map(e => ({
      kind: 'expense' as const,
      date: e.expense_date,
      expense: e,
      amountOut: Number(e.settlement_amount),
      countsInBalance: e.status !== 'rejected',
      sortKey: new Date(e.expense_date).getTime(),
    })),
  ].sort((a, b) => b.sortKey - a.sortKey), [fundings, transfersIn, transfersOut, expenses])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ledgerRows.filter((row) => {
      if (typeFilter === 'expense' && row.kind !== 'expense') return false
      if (typeFilter === 'funding' && row.kind !== 'funding') return false
      if (typeFilter === 'transfer' && row.kind !== 'transfer_in' && row.kind !== 'transfer_out') return false
      if (row.kind === 'expense') {
        if (status !== 'all' && row.expense.status !== status) return false
        if (category !== 'all' && row.expense.category !== category) return false
        if (q && !`${row.expense.concept} ${row.expense.vendor || ''}`.toLowerCase().includes(q)) return false
      } else {
        if (status !== 'all' || category !== 'all') return false
        if (q && !row.label.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [ledgerRows, search, typeFilter, status, category])

  const filtersActive = search.trim() !== '' || typeFilter !== 'all' || status !== 'all' || category !== 'all'

  function toggleCategory(key: string) {
    setCategory((prev) => (prev === key ? 'all' : (key as FinanceExpenseCategory)))
    setTypeFilter('expense')
  }

  function clearFilters() {
    setSearch('')
    setTypeFilter('all')
    setStatus('all')
    setCategory('all')
  }

  return (
    <>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Spend by category</div>
      <button
        onClick={() => setCategoryModalOpen(true)}
        className="w-full text-left border border-[#e5e3df] rounded-xl p-4 bg-white shadow-sm hover:shadow-md hover:border-[#c8973f]/30 transition-all duration-300 mb-8 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
            <Layers size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">{currencySymbol}{totalCategorySpend.toFixed(2)} across 6 categories</div>
            <div className="text-xs text-gray-500 mt-0.5 truncate">
              {topCategory && topCategory.amount > 0 ? `Most spent: ${topCategory.label} (${currencySymbol}${topCategory.amount.toFixed(2)})` : 'No spend yet'}
              {category !== 'all' && ` · Filtering: ${FINANCE_EXPENSE_CATEGORY_LABELS[category]}`}
            </div>
          </div>
        </div>
        <ChevronRight size={15} className="text-gray-400 flex-shrink-0" />
      </button>

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Transactions
          {filtersActive && (
            <span className="ml-2 font-normal normal-case text-gray-400 tracking-normal">
              {filtered.length} of {ledgerRows.length}
            </span>
          )}
        </div>
        {filtersActive && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-900 underline transition-colors">
            Clear filters
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search concept or vendor…"
            className="w-full text-xs bg-white border border-[#e5e3df] rounded-full pl-8 pr-3 py-2 placeholder:text-gray-400 focus:outline-none focus:border-black transition-colors"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-2.5 py-2 hover:border-gray-300 transition-colors"
        >
          <option value="all">All types</option>
          <option value="expense">Expenses</option>
          <option value="funding">Funding</option>
          <option value="transfer">Transfers</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-2.5 py-2 hover:border-gray-300 transition-colors"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as FinanceExpenseCategory | 'all')}
          className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-2.5 py-2 hover:border-gray-300 transition-colors"
        >
          <option value="all">All categories</option>
          {Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {ledgerRows.length === 0 ? (
        <div className="border border-dashed border-[#d8d5cf] bg-white/60 rounded-xl p-8 text-sm text-gray-500 text-center">
          No transactions yet. Use &quot;Upload receipt&quot; above to log your first one.
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-[#d8d5cf] bg-white/60 rounded-xl p-8 text-sm text-gray-500 text-center">
          No transactions match these filters.
        </div>
      ) : (
        // Same table format as the admin ledger (admin/projects/[id]/page.tsx)
        // — proper headers, same thumbnail treatment, same status badges —
        // kept consistent rather than a bespoke card layout for field users.
        <div className="bg-white border border-[#e5e3df] rounded-xl overflow-hidden overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-gray-400 border-b border-[#e5e3df] bg-[#faf9f6]">
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Date</th>
                <th className="px-4 py-2.5 font-medium">Entry</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Amount</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eeece7]">
              {filtered.map((row, i) => (
                <tr
                  key={i}
                  onClick={row.kind === 'expense' ? () => setDetailExpense(row.expense) : undefined}
                  className={`align-top hover:bg-[#faf9f6] transition-colors duration-150 ${row.kind === 'expense' ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-4 py-3.5 tabular-nums whitespace-nowrap text-gray-500">{row.date}</td>
                  {row.kind === 'expense' ? (
                    <>
                      <td className="px-4 py-3.5">
                        <div className="flex items-start gap-2.5">
                          {row.expense.receiptUrl ? (
                            <a href={row.expense.receiptUrl} target="_blank" rel="noreferrer" onClick={ev => ev.stopPropagation()} className="block group flex-shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={row.expense.receiptUrl}
                                alt="Receipt"
                                className="w-9 h-9 rounded-lg object-cover border border-[#e5e3df] transition-transform duration-200 group-hover:scale-105 group-hover:shadow-md"
                              />
                            </a>
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center flex-shrink-0">
                              <Receipt size={14} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900">{row.expense.concept}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{FINANCE_EXPENSE_CATEGORY_LABELS[row.expense.category]}</div>
                            {row.expense.ai_note && (
                              <div className="mt-1.5" onClick={ev => ev.stopPropagation()}>
                                <button
                                  onClick={() => toggleNote(row.expense.id)}
                                  className="inline-flex items-center gap-1 text-[10.5px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5 hover:bg-blue-100 transition-colors"
                                >
                                  <Sparkles size={10} /> AI review
                                  {expandedNotes.has(row.expense.id) ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                </button>
                                {expandedNotes.has(row.expense.id) && (
                                  <div className="text-xs text-blue-700 italic mt-1.5 max-w-md">{row.expense.ai_note}</div>
                                )}
                              </div>
                            )}
                            {(row.expense.finance_expense_flags ?? []).filter(f => !f.resolved).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {(row.expense.finance_expense_flags ?? []).filter(f => !f.resolved).map(f => (
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
                            {row.expense.rejection_reason && <div className="text-xs text-red-700 mt-1.5">Rejected: {row.expense.rejection_reason}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap">
                        {row.countsInBalance ? <span className="text-gray-900 font-medium">−{currencySymbol}{row.amountOut.toFixed(2)}</span> : <span className="line-through text-gray-400">{currencySymbol}{row.amountOut.toFixed(2)}</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={row.expense.status} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${row.kind === 'transfer_out' ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-600'}`}>
                            {row.kind === 'transfer_out' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                          </div>
                          <span className="font-medium text-gray-900">{row.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap font-medium">
                        {'amountIn' in row ? <span className="text-emerald-700">+{currencySymbol}{row.amountIn.toFixed(2)}</span> : <span className="text-gray-900">−{currencySymbol}{row.amountOut.toFixed(2)}</span>}
                      </td>
                      <td className="px-4 py-3.5 text-gray-300">—</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {categoryModalOpen && (
        <SpendByCategoryModal
          symbol={currencySymbol}
          categorySpend={categorySpend}
          totalCategorySpend={totalCategorySpend}
          activeCategory={category}
          onSelectCategory={(key) => { toggleCategory(key); setCategoryModalOpen(false) }}
          onClose={() => setCategoryModalOpen(false)}
        />
      )}
      {detailExpense && (
        <ExpenseDetailModal expense={detailExpense} symbol={currencySymbol} onClose={() => setDetailExpense(null)} />
      )}
    </>
  )
}

// Same modal as admin's SpendByCategoryModal, plus click-to-filter: picking a
// category here sets the Expenses table's category filter and closes the
// modal, so the breakdown and the list stay connected the way the old inline
// tiles did.
function SpendByCategoryModal({ symbol, categorySpend, totalCategorySpend, activeCategory, onSelectCategory, onClose }: {
  symbol: string
  categorySpend: Record<string, number>
  totalCategorySpend: number
  activeCategory: FinanceExpenseCategory | 'all'
  onSelectCategory: (key: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative bg-white w-full max-w-2xl shadow-2xl rounded-xl p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Spend by category</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS).map(([key, label]) => {
            const Icon = CATEGORY_ICONS[key] ?? Layers
            const amount = categorySpend[key] || 0
            const pct = totalCategorySpend > 0 ? (amount / totalCategorySpend) * 100 : 0
            const active = activeCategory === key
            return (
              <button
                key={key}
                onClick={() => onSelectCategory(key)}
                className={`text-left border rounded-xl p-3.5 bg-white transition-colors ${
                  active ? 'border-black ring-1 ring-black' : 'border-[#e5e3df] hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2.5 mb-2.5">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
                    <Icon size={14} />
                  </div>
                  <span className="text-[13px] text-gray-700 font-medium truncate">{label}</span>
                </div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-base font-semibold text-gray-900 tabular-nums">{symbol}{amount.toFixed(2)}</span>
                  {pct > 0 && <span className="text-[11px] text-gray-400 tabular-nums">{pct.toFixed(0)}%</span>}
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gray-800 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </button>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}

// Identical markup to StatusBadge in admin/projects/[id]/page.tsx — kept as
// a local copy rather than a shared import since the admin one is a private
// function in that page file, not an exported component.
function StatusBadge({ status }: { status: string }) {
  const style = status === 'verified'
    ? { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' }
    : status === 'rejected'
      ? { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' }
      : { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' }
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {status}
    </span>
  )
}
