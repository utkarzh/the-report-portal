'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowLeft, X, Check, Download, Landmark, Wallet, Clock, Users, Car, BedDouble,
  Phone, Layers, Printer, ArrowDownLeft, ArrowUpRight, Receipt, Sparkles, UserPlus, Banknote,
  ChevronDown, ChevronUp, ChevronRight, Pencil, ScrollText,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import { countryFlag } from '@/lib/country-flags'
import SendFundsModal from '@/components/finance/SendFundsModal'
import AddMemberModal from '@/components/finance/AddMemberModal'
import ChangeDirectorModal from '@/components/finance/ChangeDirectorModal'
import ExportWeekModal from '@/components/finance/ExportWeekModal'
import ExpenseDetailModal from '@/components/finance/ExpenseDetailModal'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseCategory, FinanceExpenseFlag, FinanceFunding, FinanceProject, FinanceProjectMember, FinanceTransfer } from '@/types'

type ExpenseRow = FinanceExpense & { finance_expense_flags: FinanceExpenseFlag[]; receiptUrl: string | null }
type FundingRow = FinanceFunding & { profiles: { full_name: string | null; email: string } | null }

interface Detail {
  project: FinanceProject
  members: (FinanceProjectMember & { profiles: { full_name: string | null; email: string } })[]
  fundings: FundingRow[]
  expenses: ExpenseRow[]
  transfersIn: FinanceTransfer[]
  transfersOut: FinanceTransfer[]
  balance: number
  totalFunded: number
  verifiedSpend: number
  pendingSpend: number
  categorySpend: Record<string, number>
}

type LedgerRow =
  | { kind: 'funding'; date: string; label: string; amountIn: number; sortKey: number }
  | { kind: 'transfer_in'; date: string; label: string; amountIn: number; sortKey: number }
  | { kind: 'transfer_out'; date: string; label: string; amountOut: number; sortKey: number }
  | { kind: 'expense'; date: string; expense: ExpenseRow; amountOut: number; countsInBalance: boolean; sortKey: number }

type StatusFilter = 'all' | 'pending' | 'verified' | 'rejected'
type TypeFilter = 'all' | 'expense' | 'funding' | 'transfer'

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  transport: Car,
  accommodation: BedDouble,
  communications: Phone,
  other_services: Layers,
  printing_office: Printer,
  bank_charges: Landmark,
}

export default function AdminProjectDetailPage({ params }: { params: { id: string } }) {
  const { id } = params
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [fundsModalOpen, setFundsModalOpen] = useState(false)
  const [memberModalOpen, setMemberModalOpen] = useState(false)
  const [directorModalOpen, setDirectorModalOpen] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<ExpenseRow | null>(null)
  const [detailExpense, setDetailExpense] = useState<ExpenseRow | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [teamModalOpen, setTeamModalOpen] = useState(false)
  const [rateModalOpen, setRateModalOpen] = useState(false)
  const [rateBusy, setRateBusy] = useState(false)
  const [rateError, setRateError] = useState<string | null>(null)
  const [rulesModalOpen, setRulesModalOpen] = useState(false)
  const [rulesBusy, setRulesBusy] = useState(false)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<FinanceExpenseCategory | 'all'>('all')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/finance/projects/${id}`)
      .then(r => r.json())
      .then(d => setDetail(d))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleRemoveMember(memberId: string) {
    setRemovingId(memberId)
    setMemberError(null)
    const res = await fetch(`/api/finance/projects/${id}/members?memberId=${memberId}`, { method: 'DELETE' })
    setRemovingId(null)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMemberError(data.error || 'Failed to remove member.')
      return
    }
    load()
  }

  async function handleVerify(expenseId: string) {
    setBusyId(expenseId)
    await fetch(`/api/finance/expenses/${expenseId}/verify`, { method: 'POST' })
    setBusyId(null)
    load()
  }

  function toggleSelected(expenseId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(expenseId)) next.delete(expenseId)
      else next.add(expenseId)
      return next
    })
  }

  function toggleNote(expenseId: string) {
    setExpandedNotes(prev => {
      const next = new Set(prev)
      if (next.has(expenseId)) next.delete(expenseId)
      else next.add(expenseId)
      return next
    })
  }

  async function handleApproveSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBulkBusy(true)
    await Promise.all(ids.map(expenseId => fetch(`/api/finance/expenses/${expenseId}/verify`, { method: 'POST' })))
    setBulkBusy(false)
    setSelectedIds(new Set())
    load()
  }

  async function handleUpdateRate(newRate: number) {
    setRateBusy(true)
    setRateError(null)
    const res = await fetch(`/api/finance/projects/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exchangeRate: newRate }),
    })
    setRateBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setRateError(data.error || 'Failed to update the rate.')
      return
    }
    setRateModalOpen(false)
    load()
  }

  async function handleUpdateRules(newRules: string) {
    setRulesBusy(true)
    setRulesError(null)
    const res = await fetch(`/api/finance/projects/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiRules: newRules }),
    })
    setRulesBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setRulesError(data.error || 'Failed to update the rules.')
      return
    }
    setRulesModalOpen(false)
    load()
  }

  async function handleBulkReject(reason: string) {
    const ids = Array.from(selectedIds)
    setBulkBusy(true)
    await Promise.all(ids.map(expenseId => fetch(`/api/finance/expenses/${expenseId}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    })))
    setBulkBusy(false)
    setBulkRejectOpen(false)
    setSelectedIds(new Set())
    load()
  }

  if (loading || !detail) {
    return (
      <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-pulse">
        <div className="h-3.5 w-20 bg-gray-200 rounded mb-5" />
        <div className="flex justify-between items-start mb-8">
          <div>
            <div className="h-7 w-64 bg-gray-200 rounded mb-3" />
            <div className="h-5 w-80 bg-gray-200 rounded-full" />
          </div>
          <div className="h-9 w-28 bg-gray-200 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[92px] bg-gray-200 rounded-xl" />)}
        </div>
        <div className="h-48 bg-gray-200 rounded-xl mb-10" />
        <div className="h-64 bg-gray-200 rounded-xl" />
      </div>
    )
  }

  const { project, members, fundings, expenses, transfersIn, transfersOut, balance, totalFunded, verifiedSpend, categorySpend } = detail
  const symbol = project.settlement_currency === 'USD' ? '$' : '€'
  const director = members.find(m => m.project_role === 'director')
  const directorName = director?.profiles?.full_name || director?.profiles?.email || null
  const pendingCount = expenses.filter(e => e.status === 'pending').length
  const totalCategorySpend = Object.values(categorySpend).reduce((sum, v) => sum + (v || 0), 0)
  const topCategory = Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS)
    .map(([key, label]) => ({ key, label, amount: categorySpend[key] || 0 }))
    .sort((a, b) => b.amount - a.amount)[0]

  const ledgerRows: LedgerRow[] = [
    ...fundings.map(f => ({
      kind: 'funding' as const,
      date: f.date_sent,
      label: `Transfer → ${directorName || 'director'}${f.profiles ? ` · sent by ${f.profiles.full_name || f.profiles.email}` : ''}`,
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
  ].sort((a, b) => b.sortKey - a.sortKey)

  const filteredLedger = ledgerRows.filter(row => {
    if (typeFilter === 'expense' && row.kind !== 'expense') return false
    if (typeFilter === 'funding' && row.kind !== 'funding') return false
    if (typeFilter === 'transfer' && row.kind !== 'transfer_in' && row.kind !== 'transfer_out') return false
    if (row.kind === 'expense') {
      if (statusFilter !== 'all' && row.expense.status !== statusFilter) return false
      if (categoryFilter !== 'all' && row.expense.category !== categoryFilter) return false
    } else if (statusFilter !== 'all' || categoryFilter !== 'all') {
      return false
    }
    return true
  })
  const filtersActive = typeFilter !== 'all' || statusFilter !== 'all' || categoryFilter !== 'all'

  const visiblePendingExpenseIds = filteredLedger
    .filter((r): r is Extract<LedgerRow, { kind: 'expense' }> => r.kind === 'expense' && r.expense.status === 'pending')
    .map(r => r.expense.id)
  const allPendingSelected = visiblePendingExpenseIds.length > 0 && visiblePendingExpenseIds.every(pid => selectedIds.has(pid))

  function toggleSelectAllPending() {
    setSelectedIds(allPendingSelected ? new Set() : new Set(visiblePendingExpenseIds))
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <Link
        href="/finance/admin"
        className="group inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 mb-4 transition-colors"
      >
        <ArrowLeft size={13} className="transition-transform duration-200 group-hover:-translate-x-0.5" /> Overview
      </Link>

      <div className="flex justify-between items-start flex-wrap gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{project.name}</h1>
          <div className="flex items-center gap-2 flex-wrap mt-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-[#e5e3df] rounded-full px-2.5 py-1">
              <span aria-hidden="true">{countryFlag(project.country)}</span> {project.country}
            </span>
            <button
              onClick={() => setRateModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-[#e5e3df] rounded-full px-2.5 py-1 hover:border-gray-300 transition-colors"
            >
              <Banknote size={12} className="text-gray-400" />
              {project.settlement_currency} · rate {project.exchange_rate}
              <Pencil size={10} className="text-gray-400" />
            </button>
            {directorName ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-[#e5e3df] rounded-full px-2.5 py-1">
                <span className="w-4 h-4 rounded-full bg-gray-900 text-white flex items-center justify-center text-[9px] font-semibold flex-shrink-0">
                  {directorName[0].toUpperCase()}
                </span>
                Field Director - {directorName}
              </span>
            ) : (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                No director assigned
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setRulesModalOpen(true)}
            className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-3.5 py-2.5 hover:border-gray-300 hover:shadow-sm transition-all duration-200 flex items-center gap-1.5"
          >
            <ScrollText size={13} /> AI rules
          </button>
          <button
            onClick={() => setExportModalOpen(true)}
            className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-3.5 py-2.5 hover:border-gray-300 hover:shadow-sm transition-all duration-200 flex items-center gap-1.5"
          >
            <Download size={13} /> Export week (Excel)
          </button>
          <Button size="sm" onClick={() => setFundsModalOpen(true)}>Send funds</Button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="bg-white border border-[#e5e3df] rounded-2xl p-6 shadow-sm mb-10"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Wallet size={14} className="text-emerald-600" />
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Current balance</span>
            </div>
            <div className="text-4xl font-bold tabular-nums text-emerald-700">{symbol}{balance.toFixed(2)}</div>
            <div className="text-xs text-gray-400 mt-1.5 tabular-nums">
              {symbol}{verifiedSpend.toFixed(2)} verified spend · {symbol}{totalFunded.toFixed(2)} funds received
            </div>
            {pendingCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-700 mt-1.5">
                <Clock size={12} /> {pendingCount} awaiting your review
              </div>
            )}
          </div>
          <button
            onClick={() => setTeamModalOpen(true)}
            className="inline-flex items-center gap-2 text-xs font-medium text-gray-600 border border-[#e5e3df] bg-white rounded-lg px-3 py-2 hover:border-gray-300 hover:shadow-sm transition-all duration-200"
          >
            <Users size={13} className="text-gray-400 flex-shrink-0" />
            {members.length} member{members.length === 1 ? '' : 's'}{directorName ? ` · ${directorName}` : ''}
            <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />
          </button>
        </div>
      </motion.div>

      <SectionHeader>Spend by category</SectionHeader>
      <button
        onClick={() => setCategoryModalOpen(true)}
        className="w-full text-left border border-[#e5e3df] rounded-xl p-4 bg-white shadow-sm hover:shadow-md hover:border-[#c8973f]/30 transition-all duration-300 mb-10 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
            <Layers size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">{symbol}{totalCategorySpend.toFixed(2)} across 6 categories</div>
            <div className="text-xs text-gray-500 mt-0.5 truncate">
              {topCategory && topCategory.amount > 0 ? `Most spent: ${topCategory.label} (${symbol}${topCategory.amount.toFixed(2)})` : 'No spend yet'}
            </div>
          </div>
        </div>
        <ChevronRight size={15} className="text-gray-400 flex-shrink-0" />
      </button>

      <SectionHeader
        action={selectedIds.size > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{selectedIds.size} selected</span>
            <button
              onClick={handleApproveSelected}
              disabled={bulkBusy}
              className="text-xs font-medium bg-black text-white rounded-lg px-3.5 py-2 hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <Check size={13} /> Approve selected
            </button>
            <button
              onClick={() => setBulkRejectOpen(true)}
              disabled={bulkBusy}
              className="text-xs font-medium border border-red-200 text-red-600 bg-white rounded-lg px-3.5 py-2 hover:bg-red-50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <X size={13} /> Reject selected
            </button>
          </div>
        ) : pendingCount > 0 && (
          <span className="text-xs text-gray-400">{pendingCount} awaiting review — check rows to approve or reject in bulk</span>
        )}
      >
        Transactions
      </SectionHeader>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as TypeFilter)}
          className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-2.5 py-1.5 hover:border-gray-300 transition-colors"
        >
          <option value="all">All types</option>
          <option value="expense">Expenses</option>
          <option value="funding">Funding</option>
          <option value="transfer">Transfers</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-2.5 py-1.5 hover:border-gray-300 transition-colors"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value as FinanceExpenseCategory | 'all')}
          className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-2.5 py-1.5 hover:border-gray-300 transition-colors"
        >
          <option value="all">All categories</option>
          {Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        {filtersActive && (
          <button
            onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setCategoryFilter('all') }}
            className="text-xs text-gray-500 hover:text-gray-900 underline transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {filteredLedger.length === 0 ? (
        <div className="border border-dashed border-[#d8d5cf] bg-white/60 rounded-xl p-8 text-sm text-gray-500 mb-10 text-center">
          {ledgerRows.length === 0 ? 'No transactions yet.' : 'No transactions match these filters.'}
        </div>
      ) : (
        <div className="bg-white border border-[#e5e3df] rounded-xl overflow-hidden overflow-x-auto shadow-sm mb-10">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-gray-400 border-b border-[#e5e3df] bg-[#faf9f6]">
                <th className="px-4 py-2.5 font-medium w-8">
                  {visiblePendingExpenseIds.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allPendingSelected}
                      onChange={toggleSelectAllPending}
                      className="w-3.5 h-3.5 rounded border-gray-300 accent-black cursor-pointer"
                      aria-label="Select all pending"
                    />
                  )}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Date</th>
                <th className="px-4 py-2.5 font-medium">Entry</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Amount</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eeece7]">
              {filteredLedger.map((row, i) => (
                <tr
                  key={i}
                  onClick={row.kind === 'expense' ? () => setDetailExpense(row.expense) : undefined}
                  className={`align-top hover:bg-[#faf9f6] transition-colors duration-150 ${row.kind === 'expense' ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                    {row.kind === 'expense' && row.expense.status === 'pending' && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.expense.id)}
                        onChange={() => toggleSelected(row.expense.id)}
                        className="w-3.5 h-3.5 rounded border-gray-300 accent-black cursor-pointer"
                        aria-label={`Select ${row.expense.concept}`}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums whitespace-nowrap text-gray-500">{row.date}</td>
                  {row.kind === 'expense' ? (
                    <>
                      <td className="px-4 py-3.5">
                        <div className="flex items-start gap-2.5">
                          {row.expense.receiptUrl ? (
                            <a href={row.expense.receiptUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="block group flex-shrink-0">
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
                            <div className="text-xs text-gray-500 mt-0.5">
                              {FINANCE_EXPENSE_CATEGORY_LABELS[row.expense.category]} · logged by {row.expense.logged_by_name}
                            </div>
                            {row.expense.ai_note && (
                              <div className="mt-1.5" onClick={e => e.stopPropagation()}>
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
                            {row.expense.finance_expense_flags.filter(f => !f.resolved).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {row.expense.finance_expense_flags.filter(f => !f.resolved).map(f => (
                                  <span key={f.id} className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded ${f.severity === 'crit' ? 'bg-red-50 text-red-700' : f.severity === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                                    {f.message}
                                  </span>
                                ))}
                              </div>
                            )}
                            {row.expense.rejection_reason && (
                              <div className="text-xs text-red-700 mt-1.5">Rejected: {row.expense.rejection_reason}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap">
                        {row.countsInBalance ? <span className="text-gray-900 font-medium">−{symbol}{row.amountOut.toFixed(2)}</span> : <span className="line-through text-gray-400">{symbol}{row.amountOut.toFixed(2)}</span>}
                      </td>
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col items-start gap-2">
                          <StatusBadge status={row.expense.status} />
                          {row.expense.status === 'pending' && (
                            <div className="flex gap-2">
                              <button onClick={() => handleVerify(row.expense.id)} disabled={busyId === row.expense.id} className="inline-flex items-center gap-1 text-[11px] font-medium bg-black text-white rounded-md px-2.5 py-1.5 hover:bg-gray-800 disabled:opacity-50 transition-colors">
                                <Check size={11} /> Verify
                              </button>
                              <button onClick={() => setRejectTarget(row.expense)} disabled={busyId === row.expense.id} className="inline-flex items-center gap-1 text-[11px] font-medium border border-red-200 text-red-600 rounded-md px-2.5 py-1.5 hover:bg-red-50 disabled:opacity-50 transition-colors">
                                <X size={11} /> Reject
                              </button>
                            </div>
                          )}
                        </div>
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
                        {'amountIn' in row ? <span className="text-emerald-700">+{symbol}{row.amountIn.toFixed(2)}</span> : <span className="text-gray-900">−{symbol}{row.amountOut.toFixed(2)}</span>}
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

      <SendFundsModal
        open={fundsModalOpen}
        onClose={() => setFundsModalOpen(false)}
        onSent={load}
        projectId={project.id}
        settlementCurrency={project.settlement_currency}
      />
      <AddMemberModal
        open={memberModalOpen}
        onClose={() => setMemberModalOpen(false)}
        onAdded={load}
        projectId={project.id}
        existingMemberUserIds={members.map(m => m.user_id)}
      />
      <ChangeDirectorModal
        open={directorModalOpen}
        onClose={() => setDirectorModalOpen(false)}
        onChanged={load}
        projectId={project.id}
        currentDirectorUserId={director?.user_id}
      />
      <ExportWeekModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        projectId={project.id}
        projectCreatedAt={project.created_at}
      />
      {rejectTarget && (
        <RejectExpenseModal expense={rejectTarget} onClose={() => setRejectTarget(null)} onRejected={() => { setRejectTarget(null); load() }} />
      )}
      {detailExpense && (
        <ExpenseDetailModal expense={detailExpense} symbol={symbol} onClose={() => setDetailExpense(null)} />
      )}
      {bulkRejectOpen && (
        <BulkRejectModal count={selectedIds.size} busy={bulkBusy} onClose={() => setBulkRejectOpen(false)} onSubmit={handleBulkReject} />
      )}
      {categoryModalOpen && (
        <SpendByCategoryModal
          symbol={symbol}
          categorySpend={categorySpend}
          totalCategorySpend={totalCategorySpend}
          onClose={() => setCategoryModalOpen(false)}
        />
      )}
      {rateModalOpen && (
        <EditRateModal
          currentRate={project.exchange_rate}
          currency={project.settlement_currency}
          country={project.country}
          busy={rateBusy}
          error={rateError}
          onClose={() => { setRateModalOpen(false); setRateError(null) }}
          onSubmit={handleUpdateRate}
        />
      )}
      {rulesModalOpen && (
        <EditAiRulesModal
          currentRules={project.ai_rules}
          busy={rulesBusy}
          error={rulesError}
          onClose={() => { setRulesModalOpen(false); setRulesError(null) }}
          onSubmit={handleUpdateRules}
        />
      )}
      {teamModalOpen && (
        <TeamModal
          members={members}
          memberError={memberError}
          removingId={removingId}
          onAddMember={() => { setTeamModalOpen(false); setMemberModalOpen(true) }}
          onChangeDirector={() => { setTeamModalOpen(false); setDirectorModalOpen(true) }}
          onRemoveMember={handleRemoveMember}
          onClose={() => setTeamModalOpen(false)}
        />
      )}
    </div>
  )
}

function SectionHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</h2>
      {action}
    </div>
  )
}

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

function EditRateModal({ currentRate, currency, country, busy, error, onClose, onSubmit }: {
  currentRate: number; currency: string; country: string; busy: boolean; error: string | null
  onClose: () => void; onSubmit: (rate: number) => void
}) {
  const [value, setValue] = useState(String(currentRate))
  const [localError, setLocalError] = useState<string | null>(null)

  function handleSubmit() {
    const rate = Number(value)
    if (!Number.isFinite(rate) || rate <= 0) { setLocalError('Enter a positive number.'); return }
    setLocalError(null)
    onSubmit(rate)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative bg-white w-full max-w-sm shadow-2xl rounded-xl p-6"
      >
        <h3 className="text-sm font-semibold mb-1">Update exchange rate</h3>
        <p className="text-xs text-gray-500 mb-4">
          {country} local currency per 1 {currency}. Only affects expenses logged from now on — every expense
          already logged keeps the rate that was in effect at the time.
        </p>
        {(error || localError) && (
          <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{error || localError}</div>
        )}
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={e => setValue(e.target.value)}
          className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 transition-colors tabular-nums"
        />
        <div className="flex gap-3 pt-3">
          <button onClick={handleSubmit} disabled={busy} className="text-xs font-medium bg-black text-white rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50 transition-colors">
            Save rate
          </button>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
        </div>
      </motion.div>
    </div>
  )
}

function EditAiRulesModal({ currentRules, busy, error, onClose, onSubmit }: {
  currentRules: string; busy: boolean; error: string | null
  onClose: () => void; onSubmit: (rules: string) => void
}) {
  const [value, setValue] = useState(currentRules)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative bg-white w-full max-w-md shadow-2xl rounded-xl p-6"
      >
        <h3 className="text-sm font-semibold mb-1">AI checking rules</h3>
        <p className="text-xs text-gray-500 mb-4">
          Plain-English rules specific to this project. The AI treats these as strict requirements when
          reading receipts and flags anything that breaks them — on top of the standard checks (duplicates,
          weekend dates, budget caps) that already run on every project. Only affects receipts read from now on.
        </p>
        {error && (
          <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{error}</div>
        )}
        <textarea
          className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 min-h-[120px] focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 transition-colors"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={'e.g. "Don\'t count expenses logged on Saturday or Sunday for this project." / "Flag any taxi expense over $40."'}
        />
        <div className="flex gap-3 pt-3">
          <button onClick={() => onSubmit(value)} disabled={busy} className="text-xs font-medium bg-black text-white rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50 transition-colors">
            Save rules
          </button>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
        </div>
      </motion.div>
    </div>
  )
}

function SpendByCategoryModal({ symbol, categorySpend, totalCategorySpend, onClose }: {
  symbol: string; categorySpend: Record<string, number>; totalCategorySpend: number; onClose: () => void
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
            return (
              <div key={key} className="border border-[#e5e3df] rounded-xl p-3.5 bg-white">
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
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}

function TeamModal({ members, memberError, removingId, onAddMember, onChangeDirector, onRemoveMember, onClose }: {
  members: (FinanceProjectMember & { profiles: { full_name: string | null; email: string } })[]
  memberError: string | null
  removingId: string | null
  onAddMember: () => void
  onChangeDirector: () => void
  onRemoveMember: (memberId: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative bg-white w-full max-w-lg shadow-2xl rounded-xl p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Team</h3>
          <div className="flex items-center gap-3">
            <button onClick={onAddMember} className="text-xs font-medium text-gray-600 hover:text-black transition-colors flex items-center gap-1.5">
              <UserPlus size={13} /> Add member
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-900 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
        {memberError && (
          <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{memberError}</div>
        )}
        {members.length === 0 ? (
          <div className="text-sm text-gray-500 py-2">No team members yet.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {members.map(m => {
              const name = m.profiles?.full_name || m.profiles?.email || '?'
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-[#efeeea] bg-[#faf9f6] hover:bg-white hover:border-[#e5e3df] hover:shadow-sm transition-all duration-200"
                >
                  <div className="w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {name[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-gray-900 truncate">{name}</div>
                    <div className="text-xs text-gray-500">{m.project_role === 'director' ? 'Director · accountable' : 'Sales rep'}</div>
                  </div>
                  {m.project_role === 'director' ? (
                    <button
                      onClick={onChangeDirector}
                      className="text-[11px] font-medium text-gray-500 hover:text-black underline flex-shrink-0 transition-colors"
                    >
                      Change
                    </button>
                  ) : (
                    <button
                      onClick={() => onRemoveMember(m.id)}
                      disabled={removingId === m.id}
                      title="Remove from project"
                      className="text-gray-300 hover:text-red-600 transition-colors disabled:opacity-40 flex-shrink-0"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </motion.div>
    </div>
  )
}

function BulkRejectModal({ count, busy, onClose, onSubmit }: { count: number; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit() {
    if (!reason.trim()) { setError('A reason is required.'); return }
    onSubmit(reason.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative bg-white w-full max-w-sm shadow-2xl rounded-xl p-6"
      >
        <h3 className="text-sm font-semibold mb-1">Reject {count} expense{count === 1 ? '' : 's'}</h3>
        <p className="text-xs text-gray-500 mb-4">This reason is emailed to each uploader right away.</p>
        {error && <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{error}</div>}
        <textarea
          className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 min-h-[80px] focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 transition-colors"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Shown to every selected uploader, e.g. this batch is missing receipts."
        />
        <div className="flex gap-3 pt-3">
          <button onClick={handleSubmit} disabled={busy} className="text-xs font-medium bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-50 transition-colors">
            Reject Expense Log
          </button>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
        </div>
      </motion.div>
    </div>
  )
}

function RejectExpenseModal({ expense, onClose, onRejected }: { expense: ExpenseRow; onClose: () => void; onRejected: () => void }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!reason.trim()) { setError('A reason is required.'); return }
    setLoading(true)
    const res = await fetch(`/api/finance/expenses/${expense.id}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to reject.')
      setLoading(false)
      return
    }
    onRejected()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative bg-white w-full max-w-sm shadow-2xl rounded-xl p-6"
      >
        <h3 className="text-sm font-semibold mb-1">Reject expense</h3>
        <p className="text-xs text-gray-500 mb-4">{expense.concept}</p>
        {error && <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{error}</div>}
        <textarea
          className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 min-h-[80px] focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 transition-colors"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Shown to the uploader by email right away, e.g. this looks like a duplicate of the 14 Jul taxi."
        />
        <div className="flex gap-3 pt-3">
          <button onClick={handleSubmit} disabled={loading} className="text-xs font-medium bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-50 transition-colors">
            Reject Expense Log
          </button>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
        </div>
      </motion.div>
    </div>
  )
}
