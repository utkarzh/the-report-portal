'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import Button from '@/components/ui/Button'
import CopywritingLoader from '@/components/copywriting/CopywritingLoader'

interface Props {
  /** Facts the writer model flagged as missing in the latest draft/refine and that haven't been researched yet. */
  flaggedGaps?: string[]
  /** True while a research call is running. */
  busy: boolean
  onResearch: (claims: string[]) => void
}

// The writer's own entry point to Gemini research. Nothing is researched
// automatically: Claude only *flags* missing facts while drafting/refining;
// the writer picks which to research, or asks for anything specific/new.
// Findings land in the Research Ledger as pending, for approve/discard.
export default function ResearchRequestPanel({ flaggedGaps = [], busy, onResearch }: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')

  // Drop selections for gaps that are no longer offered (e.g. just researched).
  const selectedNow = selected.filter((g) => flaggedGaps.includes(g))
  const allSelected = flaggedGaps.length > 0 && selectedNow.length === flaggedGaps.length
  const customClaims = custom
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim())
    .filter((l) => l.length > 2)

  function toggle(gap: string) {
    setSelected((prev) => (prev.includes(gap) ? prev.filter((g) => g !== gap) : [...prev, gap]))
  }

  return (
    <div className="bg-white border border-[#e5e3df] p-6">
      <div className="flex items-center gap-2">
        <Search size={14} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900">Research with Gemini</h3>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Gemini checks each item against outside sources. Findings go to the Research Ledger for you to approve or discard.
      </p>

      {flaggedGaps.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-amber-900">
              Claude flagged {flaggedGaps.length} fact{flaggedGaps.length === 1 ? '' : 's'} it couldn’t find in your sources
            </p>
            <label className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = selectedNow.length > 0 && !allSelected }}
                onChange={() => setSelected(allSelected ? [] : flaggedGaps)}
              />
              Select all
            </label>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {flaggedGaps.map((g) => (
              <label key={g} className="flex items-start gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={selectedNow.includes(g)} onChange={() => toggle(g)} className="mt-0.5" />
                <span>{g}</span>
              </label>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            disabled={selectedNow.length === 0 || busy}
            disabledReason={busy ? 'Research is already running' : 'Tick at least one fact above'}
            onClick={() => { onResearch(selectedNow); setSelected([]) }}
          >
            Research selected ({selectedNow.length})
          </Button>
        </div>
      )}

      <div className="mt-4">
        <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Research something specific or new
        </label>
        <textarea
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          rows={3}
          disabled={busy}
          placeholder={'One item per line, e.g.\n2025 tourist arrivals in Sikkim\nYear the Darjeeling Himalayan Railway became a UNESCO site'}
          className="mt-1.5 w-full rounded-lg border border-[#e5e3df] px-3 py-2 text-sm focus:border-black focus:outline-none disabled:bg-gray-50"
        />
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          disabled={customClaims.length === 0 || busy}
          disabledReason={busy ? 'Research is already running' : 'Type at least one thing to research'}
          onClick={() => { onResearch(customClaims); setCustom('') }}
        >
          Research{customClaims.length > 1 ? ` ${customClaims.length} items` : ''}
        </Button>
      </div>

      {busy && (
        <div className="mt-4">
          <CopywritingLoader variant="research" compact />
        </div>
      )}
    </div>
  )
}
