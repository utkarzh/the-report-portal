'use client'

import { useEffect, useState } from 'react'
import { X, Flag, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import type { SalesCoachCorrection } from '@/types'

export interface FlagTarget {
  criterionKey: string | null
  fieldLabel: string
  aiSaid: string
  // True for the card-level "General feedback" entry point (not tied to any
  // one criterion or the Commercial Outcome) — changes only the modal's copy.
  general?: boolean
}

interface Props {
  negotiationId: string
  target: FlagTarget | null
  onClose: () => void
  onSaved: (correction: SalesCoachCorrection) => void
  onRegenerate: () => void
}

// The correction flow described by the client: the Sales Executive tells the
// coach a fact it got wrong (a misheard number, a fact off the recording),
// saves it, and is then asked "should I go ahead?" before spending budget on
// a regenerate. Saving the correction is free (no Claude call); regenerating
// reuses NegotiationWorkspace's existing runAnalyze, which folds every
// correction on record into the next Report Card.
export default function CorrectionModal({ negotiationId, target, onClose, onSaved, onRegenerate }: Props) {
  const [value, setValue] = useState('')
  const [phase, setPhase] = useState<'form' | 'saving' | 'saved'>('form')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValue('')
    setPhase('form')
    setError(null)
  }, [target])

  if (!target) return null

  async function save() {
    if (!target || !value.trim()) return
    setPhase('saving')
    setError(null)
    try {
      const res = await fetch(`/api/sales-coach/${negotiationId}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          criterionKey: target.criterionKey,
          fieldLabel: target.fieldLabel,
          aiSaid: target.aiSaid,
          correction: value.trim(),
        }),
      })
      const data = await res.json().catch(() => ({})) as { correction?: SalesCoachCorrection; error?: string }
      if (!res.ok || !data.correction) throw new Error(data.error || 'Could not save the correction')
      onSaved(data.correction)
      setPhase('saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the correction')
      setPhase('form')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={phase === 'saving' ? undefined : onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          disabled={phase === 'saving'}
          className="absolute right-4 top-4 text-gray-300 transition-colors hover:text-gray-600"
        >
          <X size={16} />
        </button>

        {phase === 'saved' ? (
          <div className="text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={19} />
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-900">Correction saved</p>
            <p className="mt-1.5 text-xs leading-5 text-gray-500">
              This is now on record and will be treated as ground truth. Regenerate the Report Card now to apply it?
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => { onRegenerate(); onClose() }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-black px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-gray-900"
              >
                <RefreshCw size={12} /> Regenerate now
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Flag size={14} className="text-[#a07530]" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">
                {target.general ? 'General feedback' : `Correct: ${target.fieldLabel}`}
              </p>
            </div>
            {target.aiSaid && (
              <div className="mt-3 rounded-lg bg-[#faf9f7] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">What the AI read</p>
                <p className="mt-1 text-sm italic leading-6 text-gray-600">{target.aiSaid}</p>
              </div>
            )}
            <div className="mt-3">
              <Textarea
                label={target.general ? 'Anything the coach got wrong or missed' : "What's actually correct"}
                hint={target.general ? 'not tied to one section — write as much as you need' : 'e.g. the real number, or when this actually happened'}
                rows={target.general ? 5 : 3}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            </div>
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={phase === 'saving'}
                className="flex-1 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={phase === 'saving' || !value.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-black px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
              >
                {phase === 'saving' && <Loader2 size={12} className="animate-spin" />} Save correction
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
