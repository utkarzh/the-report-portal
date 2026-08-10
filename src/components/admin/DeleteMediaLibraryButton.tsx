'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'

export default function DeleteMediaLibraryButton({
  entryId,
  publicationName,
}: {
  entryId: string
  publicationName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/meeting-prep/media-library/${entryId}`, { method: 'DELETE' })
    setLoading(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to delete publication.')
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-red-500 hover:text-red-700 transition-colors px-3 py-1.5 border border-red-200 hover:border-red-400"
      >
        Delete
      </button>

      {error && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-50 border border-red-200 text-xs text-red-700 px-4 py-3 shadow-lg max-w-xs">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => { setOpen(false); setError(null) }}
        onConfirm={handleDelete}
        title={`Delete "${publicationName}"?`}
        description="This publication profile will be removed. Meeting prep sessions already created for it keep their snapshotted media details."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={loading}
      />
    </>
  )
}
