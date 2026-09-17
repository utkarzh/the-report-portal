'use client'

import { useState } from 'react'
import { Sparkles, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import type { FinanceExpenseFlag } from '@/types'

interface Props {
  aiNote: string | null
  // Unresolved flags only — caller filters (matches every existing call site).
  flags: FinanceExpenseFlag[]
}

// Replaces the old always-expanded pile of separate colored boxes (AI note +
// one box per flag, stacked, every row) with a single compact pill that
// expands on a click anywhere on it — the ledger tables were reading as
// cluttered with 2-3 full-width callouts per row before this.
export default function AiReviewDisclosure({ aiNote, flags }: Props) {
  const [open, setOpen] = useState(false)
  if (!aiNote && flags.length === 0) return null

  const hasCrit = flags.some(f => f.severity === 'crit')
  const parts = [aiNote ? 'AI review' : null, flags.length > 0 ? `${flags.length} flag${flags.length === 1 ? '' : 's'}` : null].filter(Boolean)

  return (
    <div className="mt-1.5" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 text-[10.5px] font-medium rounded-full px-2 py-0.5 border transition-colors ${
          hasCrit
            ? 'text-red-700 bg-red-50 border-red-100 hover:bg-red-100'
            : 'text-blue-700 bg-blue-50 border-blue-100 hover:bg-blue-100'
        }`}
      >
        {hasCrit ? <AlertTriangle size={10} /> : <Sparkles size={10} />}
        {parts.join(' · ')}
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5 max-w-md">
          {aiNote && <div className="text-xs text-blue-700 italic bg-blue-50/70 rounded-lg px-2.5 py-1.5">{aiNote}</div>}
          {flags.map(f => (
            <div
              key={f.id}
              className={`text-xs px-2.5 py-1.5 rounded-lg ${
                f.severity === 'crit' ? 'bg-red-50 text-red-700' : f.severity === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
              }`}
            >
              {f.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
