'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import type { FeedbackStatus } from '@/types'
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABELS, isFeedbackStatus } from '@/lib/feedback'

// Admin-only actions on one report: set its status (the reporter sees it
// under "My reports") or delete it.
export default function FeedbackRowActions({ id, status }: { id: string; status: FeedbackStatus }) {
  const router = useRouter()
  const [value, setValue] = useState<FeedbackStatus>(status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // A refresh after the change brings the saved status back down.
  useEffect(() => setValue(status), [status])

  async function changeStatus(next: FeedbackStatus) {
    if (next === value) return
    const previous = value
    setValue(next)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not change the status.')
      }
      router.refresh()
    } catch (err) {
      setValue(previous)
      setError(err instanceof Error ? err.message : 'Could not change the status.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    const res = await fetch(`/api/feedback/${id}`, { method: 'DELETE' })
    setDeleting(false)
    if (res.ok) {
      setConfirmOpen(false)
      router.refresh()
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
          {busy ? <Loader2 size={11} className="animate-spin" /> : null}
          Status
          <select
            value={value}
            disabled={busy}
            onChange={(e) => {
              if (isFeedbackStatus(e.target.value)) changeStatus(e.target.value)
            }}
            className="rounded-md border border-[#e5e3df] bg-white px-2 py-1 touch:py-2 text-[11px] font-medium text-gray-700 transition-colors hover:border-gray-400 focus:border-black focus:outline-none disabled:opacity-50"
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FEEDBACK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          aria-label="Delete this report"
          title="Delete this report"
          className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1 touch:py-2 text-[11px] font-medium text-red-500 transition-colors hover:border-red-400 hover:text-red-700"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {error && <p className="max-w-xs text-right text-[11px] text-red-500">{error}</p>}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete this report?"
        description="It will be permanently removed, including from the reporter’s My reports."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
      />
    </div>
  )
}
