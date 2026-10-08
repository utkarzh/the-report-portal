'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, Loader2 } from 'lucide-react'

// Re-runs text extraction for a file whose processing stalled (the
// uploading tab was closed) or failed. Safe to click repeatedly.
export default function RetryExtractionButton({ versionId, label = 'Retry' }: { versionId: string; label?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      onClick={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        setBusy(true)
        await fetch(`/api/knowledge/versions/${versionId}/extract`, { method: 'POST' }).catch(() => {})
        setBusy(false)
        router.refresh()
      }}
      disabled={busy}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-black disabled:opacity-50"
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} {busy ? 'Processing…' : label}
    </button>
  )
}
