'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import type { FeedbackStatus } from '@/types'

export default function FeedbackRowActions({ id, status }: { id: string; status: FeedbackStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function toggleStatus() {
    setBusy(true)
    const res = await fetch(`/api/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status === 'new' ? 'reviewed' : 'new' }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
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
    <div className="flex items-center gap-2">
      <button
        onClick={toggleStatus}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e3df] px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900 disabled:opacity-50"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        {status === 'new' ? 'Mark reviewed' : 'Mark new'}
      </button>
      <button
        onClick={() => setConfirmOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1 text-[11px] font-medium text-red-500 transition-colors hover:border-red-400 hover:text-red-700"
      >
        <Trash2 size={11} />
      </button>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete this submission?"
        description="This feedback will be permanently removed."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
      />
    </div>
  )
}
