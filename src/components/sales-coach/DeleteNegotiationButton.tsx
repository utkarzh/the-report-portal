'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'

// Admin-only delete control for a negotiation. Two looks, like the
// transcription module's: `icon` for list cards, `button` for the detail page.
export default function DeleteNegotiationButton({
  negotiationId,
  title,
  redirectTo,
  variant = 'button',
}: {
  negotiationId: string
  title: string
  redirectTo?: string
  variant?: 'button' | 'icon'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openModal(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setOpen(true)
  }

  async function handleDelete() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/sales-coach/${negotiationId}`, { method: 'DELETE' })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to delete negotiation.')
      return
    }
    setOpen(false)
    if (redirectTo) router.push(redirectTo)
    else router.refresh()
  }

  return (
    <>
      {variant === 'icon' ? (
        <button
          onClick={openModal}
          aria-label="Delete negotiation"
          className="rounded-full bg-white/90 p-1.5 text-gray-400 shadow-sm ring-1 ring-[#e5e3df] transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={15} />
        </button>
      ) : (
        <button
          onClick={openModal}
          className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:border-red-400 hover:bg-red-50"
        >
          <Trash2 size={15} />
          <span>Delete</span>
        </button>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 z-50 max-w-xs border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 shadow-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => { setOpen(false); setError(null) }}
        onConfirm={handleDelete}
        title={`Delete "${title}"?`}
        description="This permanently deletes the negotiation, its transcript, Report Card, coaching conversation and the uploaded audio. This can't be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={loading}
      />
    </>
  )
}
