'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'

// Delete control for a transcription. Two looks:
//  - `icon`   → small trash icon, for overlaying on the list cards
//  - `button` → labelled button, for the detail page (pass redirectTo to leave
//               the now-deleted page).
export default function DeleteTranscriptionButton({
  transcriptionId,
  transcriptionTitle,
  redirectTo,
  variant = 'button',
}: {
  transcriptionId: string
  transcriptionTitle: string
  redirectTo?: string
  variant?: 'button' | 'icon'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stop the click bubbling to the surrounding card <Link>.
  function openModal(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setOpen(true)
  }

  async function handleDelete() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/transcriptions/${transcriptionId}`, { method: 'DELETE' })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to delete transcript.')
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
          aria-label="Delete transcript"
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
        title={`Delete "${transcriptionTitle}"?`}
        description="This permanently deletes the transcript, its raw and refined text, and the uploaded audio. This can't be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={loading}
      />
    </>
  )
}
