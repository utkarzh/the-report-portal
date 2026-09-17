'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Sparkles, Car, BedDouble, Phone, Layers, Printer, Landmark, ShieldCheck, Receipt as ReceiptIcon, Pencil } from 'lucide-react'
import Select from '@/components/ui/Select'
import ReceiptLightbox, { isPreviewableReceiptUrl } from '@/components/finance/ReceiptLightbox'
import { SUB_LINES_BY_CATEGORY, defaultSubLine } from '@/lib/finance-categories'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseCategory, FinanceExpenseFlag } from '@/types'
import { formatDayMonthYearTime } from '@/lib/date-format'

// Same icon set as SpendByCategoryModal (admin/projects/[id]/page.tsx and
// FieldExpensesSection.tsx) — kept in sync so a category means the same
// picture everywhere.
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  transport: Car,
  accommodation: BedDouble,
  communications: Phone,
  other_services: Layers,
  printing_office: Printer,
  bank_charges: Landmark,
}

const CATEGORY_OPTIONS = Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))

type ExpenseWithExtras = FinanceExpense & {
  receiptUrl: string | null
  finance_expense_flags?: FinanceExpenseFlag[]
}

interface EditForm {
  concept: string
  category: FinanceExpenseCategory
  subLine: string
  date: string
  vendor: string
  reference: string
  localAmount: string
  localCurrency: string
  exchangeRate: string
  nights: string
}

interface Props {
  expense: ExpenseWithExtras
  symbol: string
  onClose: () => void
  // Signed URL for the optional exchange-rate proof photo, computed by the
  // caller the same way receiptUrl is.
  exchangeRateProofUrl?: string | null
  // Finance-admin-only: lets any logged expense (any status) be corrected
  // directly from here, rather than only Verify/Reject. Field views omit
  // this — field users still only get the separate "fix & resubmit while
  // rejected" flow.
  canEdit?: boolean
  onUpdated?: () => void
}

// The upload flow collects a lot more than any compact table row shows
// (sub-line, reference, vendor, exchange rate, nights, prior approval,
// full AI note, every flag). This is the single place that lays out every
// saved field for one expense — shared by the admin ledger and the field
// expense list so "click a row" means the same thing everywhere.
export default function ExpenseDetailModal({ expense: e, symbol, onClose, exchangeRateProofUrl, canEdit, onUpdated }: Props) {
  const Icon = CATEGORY_ICONS[e.category] ?? Layers
  const unresolvedFlags = (e.finance_expense_flags ?? []).filter(f => !f.resolved)
  const resolvedFlags = (e.finance_expense_flags ?? []).filter(f => f.resolved)

  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm>(() => ({
    concept: e.concept,
    category: e.category,
    subLine: e.sub_line || defaultSubLine(e.category),
    date: e.expense_date,
    vendor: e.vendor || '',
    reference: e.reference || '',
    localAmount: String(e.local_amount),
    localCurrency: e.local_currency,
    exchangeRate: String(e.exchange_rate_used),
    nights: e.nights != null ? String(e.nights) : '',
  }))

  function updateForm(patch: Partial<EditForm>) {
    setForm(f => {
      const next = { ...f, ...patch }
      if (patch.category && patch.category !== f.category) next.subLine = defaultSubLine(patch.category)
      return next
    })
  }

  async function handleSave() {
    const localAmount = parseFloat(form.localAmount)
    const exchangeRate = parseFloat(form.exchangeRate)
    if (!form.concept.trim() || !form.date || !form.localCurrency.trim()
      || !Number.isFinite(localAmount) || localAmount <= 0
      || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      setSaveError('Concept, date, local amount, currency and exchange rate are required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    const settlementAmount = Math.round((localAmount / exchangeRate) * 100) / 100
    const res = await fetch(`/api/finance/expenses/${e.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminEdit: true,
        concept: form.concept.trim(),
        category: form.category,
        subLine: form.subLine || null,
        date: form.date,
        reference: form.reference.trim() || null,
        vendor: form.vendor.trim() || null,
        localAmount,
        localCurrency: form.localCurrency.trim().toUpperCase(),
        exchangeRate,
        settlementAmount,
        nights: form.nights ? parseInt(form.nights, 10) : null,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSaveError(data.error || 'Failed to save changes.')
      return
    }
    onUpdated?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative bg-white w-full max-w-2xl shadow-2xl rounded-xl overflow-hidden max-h-[88vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-[#e5e3df] flex-shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Icon size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 truncate">{e.concept}</h3>
              <div className="text-xs text-gray-500 mt-0.5">
                {FINANCE_EXPENSE_CATEGORY_LABELS[e.category]}{e.sub_line ? ` · ${e.sub_line}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <StatusBadge status={e.status} />
            {canEdit && !editing && (
              <button onClick={() => setEditing(true)} className="text-gray-400 hover:text-gray-900 transition-colors" title="Edit expense">
                <Pencil size={14} />
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-900 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex flex-col gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-5">
            <div className="border border-[#e5e3df] rounded-lg overflow-hidden bg-gray-50 min-h-[160px] flex items-center justify-center flex-shrink-0">
              {e.receiptUrl ? (
                <button
                  onClick={() => (isPreviewableReceiptUrl(e.receiptUrl) ? setLightboxOpen(true) : window.open(e.receiptUrl!, '_blank', 'noreferrer'))}
                  className="block w-full h-full group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={e.receiptUrl}
                    alt="Receipt"
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                </button>
              ) : (
                <div className="text-gray-400 flex flex-col items-center gap-1.5 p-4 text-center">
                  <ReceiptIcon size={20} />
                  <span className="text-xs">No image</span>
                </div>
              )}
            </div>

            {editing ? (
              <div className="flex flex-col gap-3">
                {saveError && <div className="p-2.5 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{saveError}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Concept</label>
                    <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={form.concept} onChange={ev => updateForm({ concept: ev.target.value })} />
                  </div>
                  <Select
                    label="Category"
                    options={CATEGORY_OPTIONS}
                    value={form.category}
                    onChange={ev => updateForm({ category: ev.target.value as FinanceExpenseCategory })}
                    placeholder=""
                  />
                  <Select
                    label="Sub-line"
                    options={SUB_LINES_BY_CATEGORY[form.category].map(s => ({ value: s, label: s }))}
                    value={form.subLine}
                    onChange={ev => updateForm({ subLine: ev.target.value })}
                    placeholder=""
                  />
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Date</label>
                    <input type="date" className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={form.date} onChange={ev => updateForm({ date: ev.target.value })} />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Vendor</label>
                    <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={form.vendor} onChange={ev => updateForm({ vendor: ev.target.value })} />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Reference</label>
                    <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={form.reference} onChange={ev => updateForm({ reference: ev.target.value })} />
                  </div>
                  {form.category === 'accommodation' && (
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Nights</label>
                      <input type="number" min="1" className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={form.nights} onChange={ev => updateForm({ nights: ev.target.value })} />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Local amount</label>
                    <input type="number" step="0.01" className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 tabular-nums" value={form.localAmount} onChange={ev => updateForm({ localAmount: ev.target.value })} />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Local currency</label>
                    <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 uppercase" value={form.localCurrency} onChange={ev => updateForm({ localCurrency: ev.target.value })} />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Exchange rate</label>
                    <input type="number" step="0.0001" className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 tabular-nums" value={form.exchangeRate} onChange={ev => updateForm({ exchangeRate: ev.target.value })} />
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button onClick={handleSave} disabled={saving} className="text-xs font-medium bg-black text-white rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50 transition-colors">
                    Save changes
                  </button>
                  <button onClick={() => { setEditing(false); setSaveError(null) }} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <Field label="Date" value={e.expense_date} mono />
                <Field label="Logged by" value={e.logged_by_name} />
                <Field label="Vendor" value={e.vendor || '—'} />
                <Field label="Reference" value={e.reference || '—'} />
                <Field label="Local amount" value={`${e.local_currency} ${Number(e.local_amount).toFixed(2)}`} mono />
                <Field label={`Settlement (rate ${e.exchange_rate_used})`} value={`${symbol}${Number(e.settlement_amount).toFixed(2)}`} mono />
                {exchangeRateProofUrl && (
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wide text-gray-400 mb-0.5">Rate proof</div>
                    <a href={exchangeRateProofUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline">View image</a>
                  </div>
                )}
                {e.nights != null && <Field label="Nights" value={String(e.nights)} mono />}
                {e.prior_approval_granted && (
                  <div>
                    <div className="text-[10.5px] uppercase tracking-wide text-gray-400 mb-0.5">Prior approval</div>
                    <div className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <ShieldCheck size={13} /> Granted
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {e.ai_note && (
            <div>
              <div className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-blue-700 mb-1.5">
                <Sparkles size={11} /> AI review
              </div>
              <div className="text-sm text-blue-900 bg-blue-50 border border-blue-100 rounded-lg px-3.5 py-2.5">{e.ai_note}</div>
            </div>
          )}

          {unresolvedFlags.length > 0 && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Open flags</div>
              <div className="flex flex-col gap-2">
                {unresolvedFlags.map(f => (
                  <div
                    key={f.id}
                    className={`text-xs px-3 py-2 rounded-lg border ${
                      f.severity === 'crit' ? 'bg-red-50 border-red-200 text-red-800' : f.severity === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-blue-800'
                    }`}
                  >
                    {f.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {resolvedFlags.length > 0 && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Resolved flags</div>
              <div className="flex flex-wrap gap-1.5">
                {resolvedFlags.map(f => (
                  <span key={f.id} className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 line-through">
                    {f.message}
                  </span>
                ))}
              </div>
            </div>
          )}

          {e.rejection_reason && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-red-500 mb-1.5">Rejection reason</div>
              <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">{e.rejection_reason}</div>
            </div>
          )}

          <div className="text-[11px] text-gray-400 pt-1 border-t border-[#f0efeb]">
            Logged {formatDayMonthYearTime(e.created_at)}
            {e.reviewed_at && ` · Reviewed ${formatDayMonthYearTime(e.reviewed_at)}`}
          </div>
        </div>
      </motion.div>
      {lightboxOpen && <ReceiptLightbox url={e.receiptUrl} onClose={() => setLightboxOpen(false)} />}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-gray-400 mb-0.5">{label}</div>
      <div className={`text-sm text-gray-900 ${mono ? 'tabular-nums' : ''}`}>{value}</div>
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
