'use client'

import { useEffect, useState, useCallback } from 'react'
import { Check, X, AlertTriangle, Info, Copy, ShieldAlert, ScanEye, ListChecks } from 'lucide-react'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseFlag, FinanceFlagSeverity } from '@/types'

type QueueItem = FinanceExpense & {
  finance_expense_flags: FinanceExpenseFlag[]
  finance_projects: { name: string; settlement_currency: string; exchange_rate: number }
  profiles: { full_name: string | null; email: string } | null
  receiptUrl: string | null
}

const FLAG_ICONS: Record<string, React.ElementType> = {
  duplicate: Copy,
  prior_approval_required: ShieldAlert,
  over_budget: AlertTriangle,
  missing_illegible: AlertTriangle,
  suspicious_personal: AlertTriangle,
  currency_anomaly: AlertTriangle,
  weekend: Info,
  manual_note: Info,
  ai_verification_mismatch: ScanEye,
  custom_rule_violation: ListChecks,
}

const SEVERITY_STYLE: Record<FinanceFlagSeverity, string> = {
  crit: 'bg-red-50 border-red-200 text-red-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
}

export default function ReviewQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('pending')
  const [category, setCategory] = useState('')
  const [rejectTarget, setRejectTarget] = useState<QueueItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ status })
    if (category) params.set('category', category)
    fetch(`/api/finance/review-queue?${params}`)
      .then(r => r.json())
      .then(d => setItems(d.expenses ?? []))
      .finally(() => setLoading(false))
  }, [status, category])

  useEffect(() => { load() }, [load])

  async function handleVerify(id: string) {
    setBusyId(id)
    await fetch(`/api/finance/expenses/${id}/verify`, { method: 'POST' })
    setBusyId(null)
    load()
  }

  async function handleGrantApproval(id: string) {
    setBusyId(id)
    await fetch(`/api/finance/expenses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantPriorApproval: true }),
    })
    setBusyId(null)
    load()
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Review queue</h1>
        <p className="text-sm text-gray-500 mt-1">
          Logged expenses awaiting your decision. Receipt on the left, extracted data on the right — flags surfaced automatically.
        </p>
      </div>

      <div className="flex gap-3 mb-6 max-w-md">
        <Select
          label="Status"
          options={[{ value: 'pending', label: 'Pending' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]}
          value={status}
          onChange={e => setStatus(e.target.value)}
          placeholder=""
        />
        <Select
          label="Category"
          options={Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS).map(([v, l]) => ({ value: v, label: l }))}
          value={category}
          onChange={e => setCategory(e.target.value)}
          placeholder="All categories"
        />
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="border border-[#e5e3df] bg-white rounded-xl p-8 text-center text-sm text-gray-500">
          Nothing here right now.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map(item => {
            const unresolvedFlags = item.finance_expense_flags.filter(f => !f.resolved)
            const needsApproval = unresolvedFlags.some(f => f.flag_type === 'prior_approval_required')
            return (
              <div key={item.id} className="bg-white border border-[#e5e3df] rounded-xl p-5">
                <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">{item.finance_projects?.name}</span>
                    <span className="font-semibold text-sm">{item.concept}</span>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="text-xs text-gray-500">
                    logged by {item.profiles?.full_name || item.profiles?.email} · {item.expense_date}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
                  <div className="border border-[#dedbd5] rounded-lg overflow-hidden bg-gray-50 min-h-[160px] flex items-center justify-center">
                    {item.receiptUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.receiptUrl} alt="Receipt" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-gray-400 p-4 text-center">No image (manual entry or PDF)</span>
                    )}
                  </div>

                  <div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <Field label="Category" value={FINANCE_EXPENSE_CATEGORY_LABELS[item.category]} />
                      <Field label="Date" value={item.expense_date} />
                      <Field label="Reference" value={item.reference || '—'} />
                      <Field label="Vendor" value={item.vendor || '—'} />
                      <Field label="Local amount" value={`${item.local_currency} ${Number(item.local_amount).toFixed(2)}`} />
                      <Field label={`${item.finance_projects?.settlement_currency} (rate ${item.exchange_rate_used})`} value={`${item.finance_projects?.settlement_currency} ${Number(item.settlement_amount).toFixed(2)}`} />
                    </div>

                    {item.rejection_reason && (
                      <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                        <b>Rejected:</b> {item.rejection_reason}
                      </div>
                    )}

                    {unresolvedFlags.length > 0 && (
                      <div className="mt-3 flex flex-col gap-2">
                        {unresolvedFlags.map(flag => {
                          const Icon = FLAG_ICONS[flag.flag_type] || Info
                          return (
                            <div key={flag.id} className={`flex gap-2 items-start px-3 py-2 rounded-lg border text-xs ${SEVERITY_STYLE[flag.severity]}`}>
                              <Icon size={14} className="flex-shrink-0 mt-0.5" />
                              <span>{flag.message}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {item.status === 'pending' && (
                      <div className="flex gap-2 mt-4 flex-wrap">
                        <Button size="sm" onClick={() => handleVerify(item.id)} disabled={busyId === item.id}>
                          <Check size={13} className="mr-1 inline" /> Verify &amp; deduct
                        </Button>
                        <button
                          onClick={() => setRejectTarget(item)}
                          className="text-xs font-medium border border-red-300 text-red-600 rounded-lg px-3.5 py-2 hover:bg-red-50"
                        >
                          <X size={13} className="mr-1 inline" /> Reject with reason
                        </button>
                        {needsApproval && (
                          <button
                            onClick={() => handleGrantApproval(item.id)}
                            disabled={busyId === item.id}
                            className="text-xs font-medium border border-[#e5e3df] rounded-lg px-3.5 py-2 hover:bg-gray-50"
                          >
                            Grant prior approval
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {rejectTarget && (
        <RejectModal
          item={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={() => { setRejectTarget(null); load() }}
        />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-900 tabular-nums">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const style = status === 'verified' ? 'bg-emerald-50 text-emerald-700' : status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${style}`}>{status}</span>
}

function RejectModal({ item, onClose, onRejected }: { item: QueueItem; onClose: () => void; onRejected: () => void }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!reason.trim()) { setError('A reason is required.'); return }
    setLoading(true)
    const res = await fetch(`/api/finance/expenses/${item.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
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
      <div className="relative bg-white w-full max-w-md shadow-2xl rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-1">Reject expense</h3>
        <p className="text-xs text-gray-500 mb-4">{item.concept}</p>
        {error && <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded">{error}</div>}
        <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">Reason (shown to the field user)</label>
        <textarea
          className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 min-h-[90px]"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Looks like a duplicate of the earlier taxi — re-upload with the trip time visible."
        />
        <p className="text-[11px] text-gray-500 mt-2">The item returns to the field user as &quot;Rejected — needs fix&quot;. Nothing is deducted from the balance.</p>
        <div className="flex gap-3 pt-4">
          <button onClick={handleSubmit} disabled={loading} className="text-xs font-medium bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-50">
            Send rejection
          </button>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
        </div>
      </div>
    </div>
  )
}
