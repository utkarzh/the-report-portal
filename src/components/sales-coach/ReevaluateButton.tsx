'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { postWithRetry } from '@/lib/post-with-retry'

// "Re-evaluate": copies this negotiation — every submitted field, the
// finished transcript and the corrections on this card — into a new one and
// opens it with ?start=1, so its Report Card is generated straight away with
// the current coach. Nothing to refill, no transcription to wait for; this
// negotiation and its card stay as they are. See
// POST /api/sales-coach/[id]/reevaluate.
export default function ReevaluateButton({ negotiationId }: { negotiationId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A second click can land before React re-renders the disabled button.
  const inFlight = useRef(false)

  async function handleReevaluate() {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    const data = await postWithRetry(`/api/sales-coach/${negotiationId}/reevaluate`, '{}')
    if (!data.id) {
      inFlight.current = false
      setLoading(false)
      setOpen(false)
      setError(data.error || 'Could not start the re-evaluation. Please try again.')
      return
    }
    // Stay in the loading state until the new page takes over.
    router.push(`/commercial/sales-coach/${data.id}?start=1`)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true) }}
        className="inline-flex items-center gap-2 rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400"
      >
        <RotateCcw size={13} /> Re-evaluate
      </button>

      {error && (
        <div className="fixed bottom-4 right-4 z-50 max-w-xs border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 shadow-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => { if (!loading) setOpen(false) }}
        onConfirm={handleReevaluate}
        title="Re-evaluate this negotiation?"
        description="This creates a new copy with the same details and transcript and generates a fresh Report Card with the latest TRC Sales Coach — nothing to fill in, no transcription to wait for. Corrections on this card carry over; the coaching conversation starts fresh. This Report Card stays as it is. It usually takes 2–4 minutes."
        confirmLabel="Re-evaluate"
        confirmVariant="primary"
        loading={loading}
      />
    </>
  )
}
