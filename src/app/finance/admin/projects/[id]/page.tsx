'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowLeft, X, Check, Download, Landmark, Wallet, Clock, Users, Car, BedDouble,
  Phone, Layers, Printer, ArrowDownLeft, ArrowUpRight, Receipt, UserPlus, Banknote,
  ChevronRight, Pencil, ScrollText, Archive, RotateCcw, History as HistoryIcon, Lock, Trash2,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import { countryFlag } from '@/lib/country-flags'
import { currentProjectWeek, ledgerWeekOf } from '@/lib/finance-weeks'
import SendFundsModal from '@/components/finance/SendFundsModal'
import AddMemberModal from '@/components/finance/AddMemberModal'
import ChangeDirectorModal from '@/components/finance/ChangeDirectorModal'
import ExportWeekModal from '@/components/finance/ExportWeekModal'
import ExpenseDetailModal from '@/components/finance/ExpenseDetailModal'
import AiReviewDisclosure from '@/components/finance/AiReviewDisclosure'
import AttachmentChips from '@/components/finance/AttachmentChips'
import UploaderSummary from '@/components/finance/UploaderSummary'
import WaitingBadge from '@/components/finance/WaitingBadge'
import HistoryList from '@/components/finance/HistoryList'
import RateCheck from '@/components/finance/RateCheck'
import { LatestCommentPreview, SentBackBadge, wasSentBack } from '@/components/finance/ExpenseThread'
import ReceiptLightbox, { isPreviewableReceiptUrl } from '@/components/finance/ReceiptLightbox'
import WeekNavigator, { ALL_WEEKS } from '@/components/finance/WeekNavigator'
import {
  LEDGER_SORT_OPTIONS, compareLedgerRows, fundingConversionNote, formatSignedAmount, uploaderKey, uploaderOptions, uploaderTotals,
  type LedgerSort,
} from '@/lib/finance-ledger'
import type { SignedAttachment } from '@/lib/finance-attachments'
import { formatDayMonth } from '@/lib/date-format'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseCategory, FinanceExpenseComment, FinanceExpenseFlag, FinanceFunding, FinanceProject, FinanceProjectMember, FinanceTransfer } from '@/types'

type ExpenseRow = FinanceExpense & {
  finance_expense_flags: FinanceExpenseFlag[]
  receiptUrl: string | null
  exchangeRateProofUrl: string | null
  comments: FinanceExpenseComment[]
}
type FundingRow = FinanceFunding & { profiles: { full_name: string | null; email: string } | null; attachments: SignedAttachment[] }

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
  weekAnchor: string
}

type LedgerRow =
  | { kind: 'funding'; date: string; uploadedAt: string; label: string; detail: string | null; amountIn: number; funding: FundingRow }
  | { kind: 'transfer_in'; date: string; uploadedAt: string; label: string; detail: string | null; amountIn: number }
  | { kind: 'transfer_out'; date: string; uploadedAt: string; label: string; detail: string | null; amountOut: number }
  | { kind: 'expense'; date: string; uploadedAt: string; pendingSince: string | null; expense: ExpenseRow; amountOut: number }

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
  const router = useRouter()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [fundsModalOpen, setFundsModalOpen] = useState(false)
  const [editFunding, setEditFunding] = useState<FundingRow | null>(null)
  const [memberModalOpen, setMemberModalOpen] = useState(false)
  const [directorModalOpen, setDirectorModalOpen] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<ExpenseRow | null>(null)
  const [detailExpense, setDetailExpense] = useState<ExpenseRow | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
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
  const [historyOpen, setHistoryOpen] = useState(false)
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteName, setDeleteName] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<FinanceExpenseCategory | 'all'>('all')
  const [uploaderFilter, setUploaderFilter] = useState<string>('all')
  // null = not yet chosen by the user — defaults to the project's current
  // week once `detail` has loaded (see effectiveWeek below).
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [sort, setSort] = useState<LedgerSort>('date_desc')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/finance/projects/${id}`)
      .then(r => r.json())
      .then(d => setDetail(d))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  // After a comment on the open ticket: re-read without the loading
  // skeleton (which would unmount the modal mid-conversation), and point the
  // open ticket at its fresh row so its thread includes the new message.
  async function refreshQuietly() {
    const d = await fetch(`/api/finance/projects/${id}`).then(r => r.json()).catch(() => null)
    if (!d?.project) return
    setDetail(d)
    setDetailExpense(prev => (prev ? (d.expenses as ExpenseRow[]).find(e => e.id === prev.id) ?? prev : prev))
  }

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
    setReviewError(null)
    const res = await fetch(`/api/finance/expenses/${expenseId}/verify`, { method: 'POST' })
    setBusyId(null)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setReviewError(data.error || 'Failed to verify this ticket.')
    }
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

  function openReceipt(url: string | null) {
    if (!url) return
    if (isPreviewableReceiptUrl(url)) setLightboxUrl(url)
    else window.open(url, '_blank', 'noreferrer')
  }

  async function handleApproveSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBulkBusy(true)
    setReviewError(null)
    const results = await Promise.all(ids.map(async expenseId => {
      const res = await fetch(`/api/finance/expenses/${expenseId}/verify`, { method: 'POST' })
      return res.ok ? null : ((await res.json().catch(() => ({}))).error as string | undefined) || 'Failed to verify.'
    }))
    setBulkBusy(false)
    const failed = results.filter((r): r is string => r !== null)
    if (failed.length > 0) {
      setReviewError(`${failed.length} of ${ids.length} ticket${ids.length === 1 ? '' : 's'} weren't verified. ${failed[0]}`)
    }
    setSelectedIds(new Set())
    load()
  }

  async function handleUpdateRate(newRate: number, reconvertRates: number[]) {
    setRateBusy(true)
    setRateError(null)
    const res = await fetch(`/api/finance/projects/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exchangeRate: newRate, reconvertRates }),
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

  // Close (read-only, out of the overview and backlog) or reopen.
  async function handleSetStatus(status: 'active' | 'closed') {
    setStatusBusy(true)
    setStatusError(null)
    const res = await fetch(`/api/finance/projects/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    })
    setStatusBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setStatusError(data.error || 'Failed to update the project.')
      return
    }
    setStatusConfirmOpen(false)
    setSelectedIds(new Set())
    load()
  }

  // Permanent — only offered once the project is closed.
  async function handleDelete() {
    setDeleteBusy(true)
    setDeleteError(null)
    const res = await fetch(`/api/finance/projects/${id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName: deleteName }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setDeleteBusy(false)
      setDeleteError(data.error || 'Failed to delete the project.')
      return
    }
    router.push('/finance/admin')
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

  const { project, members, fundings, expenses, transfersIn, transfersOut, balance, totalFunded, verifiedSpend, pendingSpend, categorySpend } = detail
  const weekAnchor = detail.weekAnchor ?? project.created_at
  const symbol = project.settlement_currency === 'USD' ? '$' : '€'
  const director = members.find(m => m.project_role === 'director')
  const directorName = director?.profiles?.full_name || director?.profiles?.email || null
  const pendingCount = expenses.filter(e => e.status === 'pending').length
  // A closed project is read-only here too: no funding, review, edits or
  // bulk actions until it's reopened (the API refuses them anyway).
  const closed = project.status === 'closed'
  // Pending tickets in the project's local currency, grouped by the rate they
  // were converted at — what the rate window offers to re-convert.
  const projectLocal = (project.local_currency || '').toUpperCase()
  const pendingByRate = Object.values(expenses
    .filter(e => e.status === 'pending' && (!projectLocal || (e.local_currency || '').toUpperCase() === projectLocal))
    .reduce<Record<string, RateGroup>>((acc, e) => {
      const rate = Number(e.exchange_rate_used)
      const g = (acc[String(rate)] ??= { rate, count: 0, localTotal: 0, settlementTotal: 0 })
      g.count++
      g.localTotal += Number(e.local_amount)
      g.settlementTotal += Number(e.settlement_amount)
      return acc
    }, {}))
    .sort((a, b) => b.count - a.count)
  const estimatedBalance = balance - pendingSpend
  const uploaders = uploaderOptions(expenses)
  const totalCategorySpend = Object.values(categorySpend).reduce((sum, v) => sum + (v || 0), 0)
  const topCategory = Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS)
    .map(([key, label]) => ({ key, label, amount: categorySpend[key] || 0 }))
    .sort((a, b) => b.amount - a.amount)[0]

  const ledgerRows: LedgerRow[] = ([
    ...fundings.map(f => ({
      kind: 'funding' as const,
      date: f.date_sent,
      uploadedAt: f.created_at,
      label: `Transfer → ${directorName || 'director'}${f.concept ? ` — ${f.concept}` : ''}`,
      detail: [
        f.profiles ? `sent by ${f.profiles.full_name || f.profiles.email}` : null,
        fundingConversionNote(f, project.settlement_currency),
      ].filter(Boolean).join(' · ') || null,
      amountIn: Number(f.amount),
      funding: f,
    })),
    ...transfersIn.map(t => ({
      kind: 'transfer_in' as const,
      date: t.created_at.slice(0, 10),
      uploadedAt: t.created_at,
      label: `Transfer in${t.reason ? ` — ${t.reason}` : ''}`,
      detail: null,
      amountIn: Number(t.to_amount ?? t.amount),
    })),
    ...transfersOut.map(t => ({
      kind: 'transfer_out' as const,
      date: t.created_at.slice(0, 10),
      uploadedAt: t.created_at,
      label: `Transfer out${t.reason ? ` — ${t.reason}` : ''}`,
      detail: null,
      amountOut: Number(t.amount),
    })),
    ...expenses.map(e => ({
      kind: 'expense' as const,
      date: e.expense_date,
      uploadedAt: e.created_at,
      pendingSince: e.status === 'pending' ? e.created_at : null,
      expense: e,
      amountOut: Number(e.settlement_amount),
    })),
  ] as LedgerRow[]).sort((a, b) => compareLedgerRows(a, b, sort))

  const receiptSiblingCounts: Record<string, number> = {}
  for (const e of expenses) {
    const key = e.receipt_id || e.receipt_file_path
    if (key) receiptSiblingCounts[key] = (receiptSiblingCounts[key] || 0) + 1
  }

  const filteredLedger = ledgerRows.filter(row => {
    if (typeFilter === 'expense' && row.kind !== 'expense') return false
    if (typeFilter === 'funding' && row.kind !== 'funding') return false
    if (typeFilter === 'transfer' && row.kind !== 'transfer_in' && row.kind !== 'transfer_out') return false
    if (row.kind === 'expense') {
      if (statusFilter !== 'all' && row.expense.status !== statusFilter) return false
      if (categoryFilter !== 'all' && row.expense.category !== categoryFilter) return false
      if (uploaderFilter !== 'all' && uploaderKey(row.expense) !== uploaderFilter) return false
    } else if (statusFilter !== 'all' || categoryFilter !== 'all' || uploaderFilter !== 'all') {
      return false
    }
    return true
  })
  const filtersActive = typeFilter !== 'all' || statusFilter !== 'all' || categoryFilter !== 'all' || uploaderFilter !== 'all'

  // Calendar-style single-week view (client request: "should not be shown
  // one below the other, should be dropdown changeable") — reuses the same
  // Monday–Sunday week convention the legacy caja flow and the Excel export
  // already use (see finance-weeks.ts), just applied as a filter rather
  // than stacking every week's table on the page at once.
  const weekNumberOf = (dateStr: string) => ledgerWeekOf(weekAnchor, dateStr)
  const currentWeekNumber = currentProjectWeek(weekAnchor)
  const effectiveWeek = selectedWeek ?? currentWeekNumber
  const weekCounts = ledgerRows.reduce<Record<number, number>>((acc, row) => {
    const wn = weekNumberOf(row.date)
    acc[wn] = (acc[wn] || 0) + 1
    return acc
  }, {})
  const weekLedger = effectiveWeek === ALL_WEEKS ? filteredLedger : filteredLedger.filter(row => weekNumberOf(row.date) === effectiveWeek)

  const visiblePendingExpenseIds = closed ? [] : weekLedger
    .filter((r): r is Extract<LedgerRow, { kind: 'expense' }> => r.kind === 'expense' && r.expense.status === 'pending')
    .map(r => r.expense.id)
  const allPendingSelected = visiblePendingExpenseIds.length > 0 && visiblePendingExpenseIds.every(pid => selectedIds.has(pid))
  // "Who paid what": the selected person's tickets in the current view.
  const uploaderSummary = uploaderFilter === 'all' ? null : {
    name: uploaders.find(u => u.value === uploaderFilter)?.label ?? 'Unknown',
    ...uploaderTotals(weekLedger.flatMap(r => (r.kind === 'expense' ? [r.expense] : []))),
  }

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
              disabled={closed}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-[#e5e3df] rounded-full px-2.5 py-1 hover:border-gray-300 disabled:hover:border-[#e5e3df] transition-colors"
            >
              <Banknote size={12} className="text-gray-400" />
              {project.settlement_currency} · 1 {project.settlement_currency} = {project.exchange_rate} {project.local_currency || 'local'}
              {!closed && <Pencil size={10} className="text-gray-400" />}
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
            onClick={() => setHistoryOpen(true)}
            className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-3.5 py-2.5 hover:border-gray-300 hover:shadow-sm transition-all duration-200 flex items-center gap-1.5"
          >
            <HistoryIcon size={13} /> History
          </button>
          {!closed && (
            <button
              onClick={() => setRulesModalOpen(true)}
              className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-3.5 py-2.5 hover:border-gray-300 hover:shadow-sm transition-all duration-200 flex items-center gap-1.5"
            >
              <ScrollText size={13} /> AI rules
            </button>
          )}
          <button
            onClick={() => setExportModalOpen(true)}
            className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-3.5 py-2.5 hover:border-gray-300 hover:shadow-sm transition-all duration-200 flex items-center gap-1.5"
          >
            <Download size={13} /> Export week (Excel)
          </button>
          <button
            onClick={() => { setStatusError(null); setStatusConfirmOpen(true) }}
            className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-3.5 py-2.5 hover:border-gray-300 hover:shadow-sm transition-all duration-200 flex items-center gap-1.5"
          >
            {closed ? <><RotateCcw size={13} /> Reopen project</> : <><Archive size={13} /> Close project</>}
          </button>
          {closed && (
            <button
              onClick={() => { setDeleteName(''); setDeleteError(null); setDeleteOpen(true) }}
              className="text-xs font-medium text-red-700 border border-red-200 bg-white rounded-lg px-3.5 py-2.5 hover:border-red-300 hover:bg-red-50 transition-all duration-200 flex items-center gap-1.5"
            >
              <Trash2 size={13} /> Delete project
            </button>
          )}
          {!closed && <Button size="sm" onClick={() => setFundsModalOpen(true)}>Send funds</Button>}
        </div>
      </div>

      {closed && (
        <div className="flex items-center gap-2 text-sm text-gray-700 bg-gray-100 border border-[#e5e3df] rounded-xl px-4 py-3 mb-8">
          <Lock size={14} className="text-gray-500 flex-shrink-0" />
          This project is closed — read-only for everyone, and out of the overview and review queue. Reopen it to make changes, or delete it if it&apos;s no longer needed.
        </div>
      )}

      {reviewError && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-8">
          <span className="flex-1">{reviewError}</span>
          <button onClick={() => setReviewError(null)} className="text-red-400 hover:text-red-700 transition-colors"><X size={14} /></button>
        </div>
      )}

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
            {pendingCount > 0 && (
              <div className="text-sm text-gray-500 mt-1 tabular-nums">
                Estimated{' '}
                <span className={`font-medium ${estimatedBalance < 0 ? 'text-red-600' : 'text-gray-700'}`}>{formatSignedAmount(symbol, estimatedBalance)}</span>
                {' '}if all {pendingCount} pending ticket{pendingCount === 1 ? ' is' : 's are'} approved
              </div>
            )}
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
        action={closed ? null : selectedIds.size > 0 ? (
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

      <div className="mb-3">
        <WeekNavigator
          weekAnchor={weekAnchor}
          currentWeekNumber={currentWeekNumber}
          selectedWeek={effectiveWeek}
          onChange={setSelectedWeek}
          counts={weekCounts}
          allowAll
        />
      </div>

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
        {uploaders.length > 1 && (
          <select
            value={uploaderFilter}
            onChange={e => setUploaderFilter(e.target.value)}
            aria-label="Filter by uploader"
            className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-2.5 py-1.5 hover:border-gray-300 transition-colors"
          >
            <option value="all">All uploaders</option>
            {uploaders.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        )}
        <select
          value={sort}
          onChange={e => setSort(e.target.value as LedgerSort)}
          aria-label="Sort transactions"
          className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-2.5 py-1.5 hover:border-gray-300 transition-colors"
        >
          {LEDGER_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {filtersActive && (
          <button
            onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setCategoryFilter('all'); setUploaderFilter('all') }}
            className="text-xs text-gray-500 hover:text-gray-900 underline transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {uploaderSummary && <UploaderSummary summary={uploaderSummary} symbol={symbol} />}

      {weekLedger.length === 0 ? (
        <div className="border border-dashed border-[#d8d5cf] bg-white/60 rounded-xl p-8 text-sm text-gray-500 mb-10 text-center">
          {ledgerRows.length === 0 ? 'No transactions yet.' : effectiveWeek !== ALL_WEEKS && (weekCounts[effectiveWeek] ?? 0) === 0 ? 'No transactions this week.' : 'No transactions match these filters.'}
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
              {weekLedger.map((row, i) => (
                <tr
                  key={i}
                  onClick={row.kind === 'expense' ? () => setDetailExpense(row.expense) : undefined}
                  className={`align-top hover:bg-[#faf9f6] transition-colors duration-150 ${row.kind === 'expense' ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                    {row.kind === 'expense' && row.expense.status === 'pending' && !closed && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.expense.id)}
                        onChange={() => toggleSelected(row.expense.id)}
                        className="w-3.5 h-3.5 rounded border-gray-300 accent-black cursor-pointer"
                        aria-label={`Select ${row.expense.concept}`}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums whitespace-nowrap text-gray-500">
                    {row.date}
                    {row.uploadedAt.slice(0, 10) !== row.date && (
                      <div className="text-[10.5px] text-gray-400 mt-0.5">uploaded {formatDayMonth(row.uploadedAt)}</div>
                    )}
                  </td>
                  {row.kind === 'expense' ? (
                    <>
                      <td className="px-4 py-3.5">
                        <div className="flex items-start gap-2.5">
                          {row.expense.receiptUrl ? (
                            <button onClick={e => { e.stopPropagation(); openReceipt(row.expense.receiptUrl) }} className="block group flex-shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={row.expense.receiptUrl}
                                alt="Receipt"
                                className="w-9 h-9 rounded-lg object-cover border border-[#e5e3df] transition-transform duration-200 group-hover:scale-105 group-hover:shadow-md"
                              />
                            </button>
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
                            <AiReviewDisclosure aiNote={row.expense.ai_note} flags={row.expense.finance_expense_flags.filter(f => !f.resolved)} />
                            {row.expense.rejection_reason && (
                              <div className="text-xs text-red-700 mt-1.5">Rejected: {row.expense.rejection_reason}</div>
                            )}
                            <LatestCommentPreview comments={row.expense.comments} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap">
                        {row.expense.status === 'verified' ? (
                          <span className="text-gray-900 font-medium">−{symbol}{row.amountOut.toFixed(2)}</span>
                        ) : row.expense.status === 'rejected' ? (
                          <span className="line-through text-gray-400">{symbol}{row.amountOut.toFixed(2)}</span>
                        ) : (
                          <span className="text-amber-600" title="Not yet counted — awaiting verification">{symbol}{row.amountOut.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col items-start gap-2">
                          <StatusBadge status={row.expense.status} />
                          {wasSentBack(row.expense.status, row.expense.comments) && <SentBackBadge />}
                          {row.expense.status === 'pending' && <WaitingBadge loggedAt={row.expense.created_at} />}
                          {row.expense.status === 'pending' && !closed && (
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
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900">{row.label}</div>
                            {row.detail && <div className="text-xs text-gray-500 mt-0.5">{row.detail}</div>}
                            {row.kind === 'funding' && <AttachmentChips attachments={row.funding.attachments ?? []} onOpen={openReceipt} />}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap font-medium">
                        {'amountIn' in row ? <span className="text-emerald-700">+{symbol}{row.amountIn.toFixed(2)}</span> : <span className="text-gray-900">−{symbol}{row.amountOut.toFixed(2)}</span>}
                      </td>
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        {row.kind === 'funding' && !closed ? (
                          <button
                            onClick={() => setEditFunding(row.funding)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-900 transition-colors"
                          >
                            <Pencil size={11} /> Edit
                          </button>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SendFundsModal
        open={fundsModalOpen || Boolean(editFunding)}
        onClose={() => { setFundsModalOpen(false); setEditFunding(null) }}
        onSent={load}
        projectId={project.id}
        settlementCurrency={project.settlement_currency}
        localCurrency={project.local_currency}
        editingFunding={editFunding}
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
        weekAnchor={weekAnchor}
      />
      {lightboxUrl && <ReceiptLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {rejectTarget && (
        <RejectExpenseModal expense={rejectTarget} onClose={() => setRejectTarget(null)} onRejected={() => { setRejectTarget(null); load() }} />
      )}
      {detailExpense && (
        <ExpenseDetailModal
          expense={detailExpense}
          symbol={symbol}
          onClose={() => setDetailExpense(null)}
          exchangeRateProofUrl={detailExpense.exchangeRateProofUrl}
          canEdit
          siblingCount={receiptSiblingCounts[detailExpense.receipt_id || detailExpense.receipt_file_path || ''] ?? 1}
          onUpdated={load}
          onThreadChanged={refreshQuietly}
          viewerSide="finance"
          settlementCurrency={project.settlement_currency}
          readOnly={closed}
        />
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
          localCurrency={project.local_currency}
          country={project.country}
          pendingByRate={pendingByRate}
          symbol={symbol}
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
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setHistoryOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative bg-white w-full max-w-2xl shadow-2xl rounded-xl p-6 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-1">
              <h3 className="text-sm font-semibold text-gray-900">Project history</h3>
              <button onClick={() => setHistoryOpen(false)} className="text-gray-400 hover:text-gray-900 transition-colors"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Every change to this project&apos;s money — tickets, funding, transfers, rate and status — newest first. It can&apos;t be edited.</p>
            <HistoryList projectId={project.id} />
          </motion.div>
        </div>
      )}
      {statusConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setStatusConfirmOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative bg-white w-full max-w-sm shadow-2xl rounded-xl p-6"
          >
            <h3 className="text-sm font-semibold mb-1">{closed ? 'Reopen this project?' : 'Close this project?'}</h3>
            <p className="text-xs text-gray-500 mb-4">
              {closed
                ? 'It becomes active again: the team can log tickets and Finance can review, fund and transfer.'
                : `It becomes read-only for everyone — no new tickets, reviews, edits, funds or transfers — and leaves the overview and the review queue.${pendingCount > 0 ? ` Its ${pendingCount} pending ticket${pendingCount === 1 ? '' : 's'} stay pending.` : ''} You can reopen it any time, or delete it once closed.`}
            </p>
            {statusError && <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{statusError}</div>}
            <div className="flex gap-3">
              <button
                onClick={() => handleSetStatus(closed ? 'active' : 'closed')}
                disabled={statusBusy}
                className="text-xs font-medium bg-black text-white rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {statusBusy ? 'Saving…' : closed ? 'Reopen project' : 'Close project'}
              </button>
              <button onClick={() => setStatusConfirmOpen(false)} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
            </div>
          </motion.div>
        </div>
      )}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !deleteBusy && setDeleteOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative bg-white w-full max-w-sm shadow-2xl rounded-xl p-6"
          >
            <h3 className="text-sm font-semibold mb-1">Delete this project permanently?</h3>
            <p className="text-xs text-gray-500 mb-3">
              This removes {project.name} and everything in it for everyone: {expenses.length} ticket{expenses.length === 1 ? '' : 's'}, {fundings.length} funding{fundings.length === 1 ? '' : 's'}, the team, the comment threads and every stored receipt and evidence file. It can&apos;t be undone. To keep the records, leave it closed instead.
            </p>
            <label className="block text-xs text-gray-700 mb-1.5">
              Type <span className="font-semibold text-gray-900">{project.name}</span> to confirm
            </label>
            <input
              value={deleteName}
              onChange={e => setDeleteName(e.target.value)}
              autoFocus
              className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 mb-3 focus:outline-none focus:border-gray-400"
            />
            {deleteError && <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{deleteError}</div>}
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleteBusy || deleteName.trim() !== project.name.trim()}
                className="text-xs font-medium bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteBusy ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button onClick={() => setDeleteOpen(false)} disabled={deleteBusy} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
            </div>
          </motion.div>
        </div>
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

interface RateGroup { rate: number; count: number; localTotal: number; settlementTotal: number }

// The rate is local currency per 1 settlement unit — said in words and
// checked against today's market (RateCheck), since an inverted entry here
// is what turned Jamaica's tickets into millions (client review, 26 Oct
// 2026). Pending tickets converted at another rate are listed by rate with
// their before → after totals, and the ones ticked are re-converted at the
// rate saved here — whether or not the project rate itself changes (Jamaica's
// was already corrected to 158 on its own, leaving 21 tickets at 0.0063).
// Verified and rejected tickets never change.
function EditRateModal({ currentRate, currency, localCurrency, country, pendingByRate, symbol, busy, error, onClose, onSubmit }: {
  currentRate: number; currency: string; localCurrency: string; country: string; pendingByRate: RateGroup[]; symbol: string
  busy: boolean; error: string | null
  onClose: () => void; onSubmit: (rate: number, reconvertRates: number[]) => void
}) {
  const [value, setValue] = useState(String(currentRate))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [localError, setLocalError] = useState<string | null>(null)
  const local = localCurrency || 'local currency'
  const newRate = Number(value)
  const groups = pendingByRate.filter(g => Number.isFinite(newRate) && g.rate !== newRate)

  function toggle(rate: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(rate)) next.delete(rate)
      else next.add(rate)
      return next
    })
  }

  function handleSubmit() {
    const rate = Number(value)
    if (!Number.isFinite(rate) || rate <= 0) { setLocalError('Enter a positive number.'); return }
    setLocalError(null)
    onSubmit(rate, groups.filter(g => selected.has(g.rate)).map(g => g.rate))
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
          How many {local} ({country}) make 1 {currency}. Only affects tickets logged from now on — every ticket
          already logged keeps the rate that was in effect at the time, unless you re-convert the pending ones below.
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
        {localCurrency && <RateCheck base={currency} quote={localCurrency} rate={value} onUseRate={r => setValue(String(r))} />}
        {groups.length > 0 && newRate > 0 && (
          <div className="mt-4">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Re-convert pending tickets at {value}</div>
            <div className="flex flex-col gap-1.5">
              {groups.map(g => (
                <label key={g.rate} className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer border border-[#efeeea] rounded-lg px-2.5 py-2 hover:bg-[#faf9f6]">
                  <input type="checkbox" checked={selected.has(g.rate)} onChange={() => toggle(g.rate)} className="mt-0.5 accent-black" />
                  <span className="tabular-nums">
                    <span className="font-medium">{g.count} ticket{g.count === 1 ? '' : 's'} at {g.rate}</span>
                    {' — '}{symbol}{g.settlementTotal.toFixed(2)} → {symbol}{(g.localTotal / newRate).toFixed(2)}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">Only pending {local} tickets are listed. Verified and rejected tickets never change; each re-conversion is recorded in the history.</p>
          </div>
        )}
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
