'use client'

import { useState } from 'react'
import { Flag, CheckCircle2, Undo2, Loader2 } from 'lucide-react'
import { SALES_COACH_OUTCOMES, outcomeLabel } from '@/lib/sales-coach'
import type { SalesCoachNegotiation, SalesCoachOutcome } from '@/types'

// Admin-only panel for a negotiation the Report Card flagged for management
// review (US-045). Shows the declared-vs-assessed gap, lets the manager
// record the confirmed outcome + a note, and marks it reviewed. Everything is
// stored through POST /api/sales-coach/[id]/review — no schema change.
export default function ManagementReviewPanel({
  negotiation: n,
  onUpdated,
}: {
  negotiation: SalesCoachNegotiation
  onUpdated: (n: SalesCoachNegotiation) => void
}) {
  const review = n.report_card?.review ?? null
  const [editing, setEditing] = useState(!review)
  const [outcome, setOutcome] = useState<SalesCoachOutcome | ''>(review?.confirmed_outcome ?? n.declared_outcome ?? '')
  const [note, setNote] = useState(review?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/sales-coach/${n.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { negotiation?: SalesCoachNegotiation; error?: string }
      if (!res.ok || !data.negotiation) throw new Error(data.error || 'Could not save the review.')
      onUpdated(data.negotiation)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the review.')
    } finally {
      setBusy(false)
    }
  }

  const assessed = n.ai_assessed_position || n.report_card?.assessed_position || '—'

  return (
    <div className={`rounded-2xl border p-5 ${review && !editing ? 'border-[#e5e3df] bg-white' : 'border-[#c8973f]/40 bg-[#fbf7ed]'} shadow-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-lg p-1.5 ${review && !editing ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-[#a07530]'}`}>
            {review && !editing ? <CheckCircle2 size={15} /> : <Flag size={15} />}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">Management review</p>
            <p className="mt-0.5 text-sm font-medium text-gray-900">
              {review && !editing
                ? `Reviewed by ${review.reviewed_by_name} on ${new Date(review.reviewed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : 'This negotiation needs a manager to confirm the real outcome'}
            </p>
          </div>
        </div>
        {review && !editing && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400">Edit</button>
            <button type="button" disabled={busy} onClick={() => post({ reopen: true })} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400 disabled:opacity-50">
              <Undo2 size={12} /> Reopen
            </button>
          </div>
        )}
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-white/70 px-3.5 py-2.5 ring-1 ring-[#e9e7e2]">
          <dt className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Executive declared</dt>
          <dd className="mt-0.5 font-medium text-gray-900">{outcomeLabel(n.declared_outcome)}</dd>
        </div>
        <div className="rounded-lg bg-white/70 px-3.5 py-2.5 ring-1 ring-[#e9e7e2]">
          <dt className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Coach assessed</dt>
          <dd className="mt-0.5 font-medium text-gray-900">{assessed}</dd>
        </div>
        <div className="rounded-lg bg-white/70 px-3.5 py-2.5 ring-1 ring-[#e9e7e2]">
          <dt className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Confirmed outcome</dt>
          <dd className="mt-0.5 font-medium text-gray-900">{review && !editing ? outcomeLabel(review.confirmed_outcome) : '—'}</dd>
        </div>
      </dl>
      {n.discrepancy && <p className="mt-3 text-sm leading-6 text-gray-700">{n.discrepancy}</p>}

      {review && !editing ? (
        review.note ? <p className="mt-3 rounded-lg bg-[#faf9f7] px-3.5 py-2.5 text-sm leading-6 text-gray-700">{review.note}</p> : null
      ) : (
        <div className="mt-4 border-t border-[#c8973f]/20 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">What actually happened?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SALES_COACH_OUTCOMES.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOutcome(o.value)}
                className={`rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${outcome === o.value ? 'border-black bg-black text-white' : 'border-[#e5e3df] bg-white text-gray-700 hover:border-gray-400'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Note for the record (optional) — e.g. contract received signed on 12 Sep; half page confirmed."
            className="mt-3 w-full resize-none rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !outcome}
              onClick={() => post({ confirmedOutcome: outcome, note })}
              className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Mark as reviewed
            </button>
            {review && (
              <button type="button" onClick={() => { setEditing(false); setOutcome(review.confirmed_outcome); setNote(review.note) }} className="rounded-lg px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
