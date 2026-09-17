'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceCaja, FinanceExpense, FinanceExpenseFlag, FinanceIncident, FinanceIncidentMessage, FinanceCajaEvent } from '@/types'
import { formatDayMonthYearTime } from '@/lib/date-format'

type ExpenseRow = FinanceExpense & {
  finance_expense_flags: FinanceExpenseFlag[]
  profiles: { full_name: string | null; email: string } | null
  receiptUrl: string | null
}
type IncidentRow = FinanceIncident & { finance_incident_messages: (FinanceIncidentMessage & { profiles: { full_name: string | null; email: string } | null })[] }

const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft', ready: 'Ready to submit', submitted: 'Submitted', under_review: 'Under review',
  incidents: 'Has open incidents', resubmitted: 'Resubmitted', approved: 'Approved', closed: 'Closed',
}
const VERDICT_STYLE: Record<string, string> = {
  pass: 'bg-emerald-50 text-emerald-700', pass_with_observations: 'bg-blue-50 text-blue-700',
  review_required: 'bg-amber-50 text-amber-700', high_risk: 'bg-red-50 text-red-700',
}
// Finance can triage tickets right up until the caja leaves their hands —
// this is the point of the whole page: one sitting, tickets + audit/Excel
// together, instead of a separate running review queue.
const REVIEWABLE_STAGES = ['submitted', 'under_review', 'incidents', 'resubmitted']

export default function CajaDetailPage({ params }: { params: { cajaId: string } }) {
  const { cajaId } = params
  const [caja, setCaja] = useState<FinanceCaja | null>(null)
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [events, setEvents] = useState<FinanceCajaEvent[]>([])
  const [computedBalance, setComputedBalance] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cashAmount, setCashAmount] = useState('')
  const [incidentForm, setIncidentForm] = useState<{ description: string; requiredAction: string } | null>(null)
  const [rejectTarget, setRejectTarget] = useState<ExpenseRow | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/finance/cajas/${cajaId}`).then(r => r.json()).then(d => {
      setCaja(d.caja); setExpenses(d.expenses ?? []); setIncidents(d.incidents ?? [])
      setEvents(d.events ?? []); setComputedBalance(d.computedBalance ?? 0); setIsAdmin(!!d.isFinanceAdmin)
      setCashAmount(d.caja?.cash_confirmed_amount != null ? String(d.caja.cash_confirmed_amount) : '')
    }).finally(() => setLoading(false))
  }, [cajaId])

  useEffect(() => { load() }, [load])

  async function runAction(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Action failed.')
    }
    setBusy(false)
    load()
  }

  async function handleVerify(expenseId: string) {
    setBusy(true)
    await fetch(`/api/finance/expenses/${expenseId}/verify`, { method: 'POST' })
    setBusy(false)
    load()
  }

  if (loading || !caja) return <div className="p-4 sm:p-8 text-sm text-gray-400">Loading…</div>

  const canReview = isAdmin && REVIEWABLE_STAGES.includes(caja.stage)
  const pendingCount = expenses.filter(e => e.status === 'pending').length

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <Link href={isAdmin ? '/finance/admin' : '/finance'} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 mb-3">
        <ArrowLeft size={13} /> Back
      </Link>
      <div className="flex justify-between items-start flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Week {caja.week_number}</h1>
          <p className="text-sm text-gray-500 mt-1">{caja.week_start} – {caja.week_end}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">{STAGE_LABELS[caja.stage]}</span>
          {caja.audit_verdict && (
            <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${VERDICT_STYLE[caja.audit_verdict]}`}>
              {caja.audit_verdict.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>

      {error && <div className="p-3 mb-4 bg-red-50 border border-red-200 text-sm text-red-700 rounded">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        <div className="bg-white border border-[#e5e3df] rounded-xl p-4">
          <div className="text-[10.5px] uppercase tracking-wide text-gray-400">Computed balance</div>
          <div className="text-xl font-semibold mt-1 tabular-nums">${computedBalance.toFixed(2)}</div>
        </div>
        <div className="bg-white border border-[#e5e3df] rounded-xl p-4">
          <div className="text-[10.5px] uppercase tracking-wide text-gray-400">Cash confirmed</div>
          <div className="text-xl font-semibold mt-1 tabular-nums">{caja.cash_confirmed_amount != null ? `$${Number(caja.cash_confirmed_amount).toFixed(2)}` : '—'}</div>
        </div>
        <div className="bg-white border border-[#e5e3df] rounded-xl p-4">
          <div className="text-[10.5px] uppercase tracking-wide text-gray-400">Tickets to review</div>
          <div className="text-xl font-semibold mt-1 tabular-nums">{pendingCount}</div>
        </div>
      </div>

      {/* Director actions */}
      {!isAdmin && (caja.stage === 'draft' || caja.stage === 'ready') && (
        <div className="bg-white border border-[#e5e3df] rounded-xl p-5 mb-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Cash on hand</div>
          <div className="flex gap-3 items-end flex-wrap">
            <input type="number" step="0.01" className="text-sm border border-[#e5e3df] rounded-lg px-3 py-2 tabular-nums w-40" placeholder="Amount" value={cashAmount} onChange={e => setCashAmount(e.target.value)} />
            <Button size="sm" loading={busy} onClick={() => runAction(`/api/finance/cajas/${cajaId}/cash-confirm`, { amount: parseFloat(cashAmount) })}>
              Confirm cash on hand
            </Button>
            {caja.stage === 'ready' && (
              <Button size="sm" loading={busy} onClick={() => runAction(`/api/finance/cajas/${cajaId}/submit`)}>
                Submit for review
              </Button>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Submit is blocked until cash is confirmed and no expense this week has an unresolved critical flag.</p>
        </div>
      )}

      {/* Admin actions — this is the "check once per caja" moment: work through
          the tickets below, then run the audit report, which also sends the
          director one summary email covering every decision made here.
          "Open this week" has no role gate (either side can start a caja), so
          an admin can land here on a draft/ready/closed week where there's
          nothing for Finance to do yet — show why instead of an empty box. */}
      {isAdmin && (caja.stage === 'draft' || caja.stage === 'ready') && (
        <div className="bg-white border border-[#e5e3df] rounded-xl p-5 mb-6 text-sm text-gray-500">
          Waiting on the field director to {caja.stage === 'draft' ? 'confirm cash on hand' : 'submit'} this week for review.
        </div>
      )}
      {isAdmin && caja.stage === 'closed' && (
        <div className="bg-white border border-[#e5e3df] rounded-xl p-5 mb-6 text-sm text-gray-500">
          This week is closed — nothing further to review.
        </div>
      )}
      {isAdmin && (caja.stage === 'submitted' || caja.stage === 'resubmitted' || caja.stage === 'under_review' || caja.stage === 'approved') && (
        <div className="bg-white border border-[#e5e3df] rounded-xl p-5 mb-6 flex gap-3 flex-wrap items-center">
          {(caja.stage === 'submitted' || caja.stage === 'resubmitted') && (
            <Button size="sm" loading={busy} onClick={() => runAction(`/api/finance/cajas/${cajaId}/audit`)}>Run audit report &amp; notify director</Button>
          )}
          {caja.stage === 'under_review' && (
            <>
              <Button size="sm" loading={busy} onClick={() => runAction(`/api/finance/cajas/${cajaId}/approve`)}>Approve</Button>
              <button onClick={() => setIncidentForm({ description: '', requiredAction: '' })} className="text-xs font-medium border border-[#e5e3df] rounded-lg px-3.5 py-2 hover:bg-gray-50">
                Open incident
              </button>
            </>
          )}
          {caja.stage === 'approved' && (
            <Button size="sm" loading={busy} onClick={() => runAction(`/api/finance/cajas/${cajaId}/close`)}>Close week</Button>
          )}
          {(caja.stage === 'submitted' || caja.stage === 'resubmitted') && pendingCount > 0 && (
            <p className="text-[11px] text-gray-500">{pendingCount} ticket{pendingCount === 1 ? '' : 's'} still pending below — verify or reject each, then run the audit.</p>
          )}
        </div>
      )}

      {incidentForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setIncidentForm(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-xl p-6">
            <h3 className="text-sm font-semibold mb-4">Open incident</h3>
            <div className="flex flex-col gap-3">
              <textarea className="text-sm border border-[#e5e3df] rounded-lg px-3 py-2" placeholder="Description" value={incidentForm.description} onChange={e => setIncidentForm(f => f && { ...f, description: e.target.value })} />
              <textarea className="text-sm border border-[#e5e3df] rounded-lg px-3 py-2" placeholder="Required action" value={incidentForm.requiredAction} onChange={e => setIncidentForm(f => f && { ...f, requiredAction: e.target.value })} />
              <div className="flex gap-3">
                <Button size="sm" loading={busy} onClick={async () => { await runAction(`/api/finance/cajas/${cajaId}/incidents`, incidentForm); setIncidentForm(null) }}>Open</Button>
                <button onClick={() => setIncidentForm(null)} className="text-xs text-gray-500">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {caja.audit_report && (
        <div className="mb-8">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Audit report</div>
          <div className="bg-white border border-[#e5e3df] rounded-xl p-5 text-sm whitespace-pre-wrap leading-relaxed">{caja.audit_report}</div>
        </div>
      )}

      {incidents.length > 0 && (
        <div className="mb-8">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Incidents</div>
          <div className="flex flex-col gap-3">
            {incidents.map(inc => <IncidentThread key={inc.id} incident={inc} isAdmin={isAdmin} onChanged={load} />)}
          </div>
        </div>
      )}

      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Tickets this week</div>
      <div className="flex flex-col gap-2.5 mb-8">
        {expenses.map(e => {
          const unresolvedFlags = e.finance_expense_flags.filter(f => !f.resolved)
          return (
            <div key={e.id} className="bg-white border border-[#e5e3df] rounded-xl p-4">
              <div className="flex gap-3 flex-wrap sm:flex-nowrap">
                {e.receiptUrl && (
                  <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={e.receiptUrl} alt="Receipt" className="w-16 h-16 rounded-lg object-cover border border-[#e5e3df]" />
                  </a>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2 flex-wrap">
                    <div>
                      <div className="font-medium text-sm">{e.concept}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {e.expense_date} · {FINANCE_EXPENSE_CATEGORY_LABELS[e.category]} · logged by {e.profiles?.full_name || e.profiles?.email}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm tabular-nums">${Number(e.settlement_amount).toFixed(2)}</div>
                      <StatusBadge status={e.status} />
                    </div>
                  </div>

                  {e.rejection_reason && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">{e.rejection_reason}</div>
                  )}

                  {unresolvedFlags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {unresolvedFlags.map(f => (
                        <span key={f.id} className={`text-[10.5px] px-2 py-0.5 rounded-full ${f.severity === 'crit' ? 'bg-red-50 text-red-700' : f.severity === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                          {f.message}
                        </span>
                      ))}
                    </div>
                  )}

                  {canReview && e.status === 'pending' && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => handleVerify(e.id)} disabled={busy} className="text-xs font-medium bg-black text-white rounded-lg px-3 py-1.5 hover:opacity-85 disabled:opacity-50">
                        <Check size={12} className="inline mr-1" /> Verify
                      </button>
                      <button onClick={() => setRejectTarget(e)} disabled={busy} className="text-xs font-medium border border-red-300 text-red-600 rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-50">
                        <X size={12} className="inline mr-1" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {expenses.length === 0 && (
          <div className="bg-white border border-[#e5e3df] rounded-xl p-6 text-sm text-gray-500">No expenses logged this week.</div>
        )}
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Audit trail</div>
      <div className="bg-white border border-[#e5e3df] rounded-xl p-5 flex flex-col gap-2">
        {events.map(ev => (
          <div key={ev.id} className="text-xs text-gray-500 flex justify-between flex-wrap gap-1">
            <span>{ev.from_stage ? `${ev.from_stage} → ${ev.to_stage}` : `Opened as ${ev.to_stage}`}{ev.comment ? ` — ${ev.comment}` : ''}</span>
            <span className="tabular-nums">{formatDayMonthYearTime(ev.created_at)}</span>
          </div>
        ))}
      </div>

      {rejectTarget && (
        <RejectTicketModal expense={rejectTarget} onClose={() => setRejectTarget(null)} onRejected={() => { setRejectTarget(null); load() }} />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const style = status === 'verified' ? 'bg-emerald-50 text-emerald-700' : status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
  return <span className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full ${style} inline-block mt-1`}>{status}</span>
}

function RejectTicketModal({ expense, onClose, onRejected }: { expense: ExpenseRow; onClose: () => void; onRejected: () => void }) {
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
      <div className="relative bg-white w-full max-w-sm shadow-2xl rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-1">Reject ticket</h3>
        <p className="text-xs text-gray-500 mb-4">{expense.concept}</p>
        {error && <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded">{error}</div>}
        <textarea
          className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 min-h-[80px]"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Shown to the field user — this also goes into the one summary email sent when you finish this caja's review."
        />
        <div className="flex gap-3 pt-3">
          <button onClick={handleSubmit} disabled={loading} className="text-xs font-medium bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-50">
            Reject
          </button>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function IncidentThread({ incident, isAdmin, onChanged }: { incident: IncidentRow; isAdmin: boolean; onChanged: () => void }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  async function sendReply() {
    if (!reply.trim()) return
    setBusy(true)
    await fetch(`/api/finance/incidents/${incident.id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: reply }),
    })
    setReply('')
    setBusy(false)
    onChanged()
  }

  async function resolve() {
    setBusy(true)
    await fetch(`/api/finance/incidents/${incident.id}/resolve`, { method: 'POST' })
    setBusy(false)
    onChanged()
  }

  return (
    <div className="bg-white border border-[#e5e3df] rounded-xl p-4">
      <div className="flex justify-between items-start mb-2 gap-2 flex-wrap">
        <div>
          <div className="text-sm font-medium">{incident.description}</div>
          <div className="text-xs text-gray-500 mt-0.5">Required: {incident.required_action}</div>
        </div>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${incident.status === 'resolved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {incident.status}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 mt-3">
        {incident.finance_incident_messages.map(m => (
          <div key={m.id} className="text-xs bg-gray-50 rounded px-2.5 py-1.5">
            <b>{m.profiles?.full_name || m.profiles?.email || 'Someone'}:</b> {m.message}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        <input className="flex-1 min-w-[140px] text-xs border border-[#e5e3df] rounded-lg px-2.5 py-1.5" placeholder="Reply…" value={reply} onChange={e => setReply(e.target.value)} />
        <button onClick={sendReply} disabled={busy} className="text-xs font-medium border border-[#e5e3df] rounded-lg px-3 py-1.5 hover:bg-gray-50">Send</button>
        {isAdmin && incident.status === 'open' && (
          <button onClick={resolve} disabled={busy} className="text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg px-3 py-1.5 hover:bg-emerald-50">Resolve</button>
        )}
      </div>
    </div>
  )
}
