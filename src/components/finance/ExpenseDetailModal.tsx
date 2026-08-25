'use client'

import { motion } from 'framer-motion'
import { X, Sparkles, Car, BedDouble, Phone, Layers, Printer, Landmark, ShieldCheck, Receipt as ReceiptIcon } from 'lucide-react'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseFlag } from '@/types'

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

type ExpenseWithExtras = FinanceExpense & {
  receiptUrl: string | null
  finance_expense_flags?: FinanceExpenseFlag[]
}

interface Props {
  expense: ExpenseWithExtras
  symbol: string
  onClose: () => void
}

// The upload flow collects a lot more than any compact table row shows
// (sub-line, reference, vendor, exchange rate, nights, prior approval,
// full AI note, every flag). This is the single place that lays out every
// saved field for one expense — shared by the admin ledger and the field
// expense list so "click a row" means the same thing everywhere.
export default function ExpenseDetailModal({ expense: e, symbol, onClose }: Props) {
  const Icon = CATEGORY_ICONS[e.category] ?? Layers
  const unresolvedFlags = (e.finance_expense_flags ?? []).filter(f => !f.resolved)
  const resolvedFlags = (e.finance_expense_flags ?? []).filter(f => f.resolved)

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
            <button onClick={onClose} className="text-gray-400 hover:text-gray-900 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex flex-col gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-5">
            <div className="border border-[#e5e3df] rounded-lg overflow-hidden bg-gray-50 min-h-[160px] flex items-center justify-center flex-shrink-0">
              {e.receiptUrl ? (
                <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="block w-full h-full group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={e.receiptUrl}
                    alt="Receipt"
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                </a>
              ) : (
                <div className="text-gray-400 flex flex-col items-center gap-1.5 p-4 text-center">
                  <ReceiptIcon size={20} />
                  <span className="text-xs">No image</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              <Field label="Date" value={e.expense_date} mono />
              <Field label="Logged by" value={e.logged_by_name} />
              <Field label="Vendor" value={e.vendor || '—'} />
              <Field label="Reference" value={e.reference || '—'} />
              <Field label="Local amount" value={`${e.local_currency} ${Number(e.local_amount).toFixed(2)}`} mono />
              <Field label={`Settlement (rate ${e.exchange_rate_used})`} value={`${symbol}${Number(e.settlement_amount).toFixed(2)}`} mono />
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
            Logged {new Date(e.created_at).toLocaleString()}
            {e.reviewed_at && ` · Reviewed ${new Date(e.reviewed_at).toLocaleString()}`}
          </div>
        </div>
      </motion.div>
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
