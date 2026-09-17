'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { projectWeekBounds } from '@/lib/finance-weeks'

interface Props {
  projectCreatedAt: string
  // The project's own "now" week — the ceiling on how far Next can go, and
  // which option in the dropdown gets the "(current)" label. Same
  // project-creation-date-anchored week convention as ExportWeekModal.
  currentWeekNumber: number
  selectedWeek: number
  onChange: (week: number) => void
  // Optional per-week transaction count, shown in the dropdown so it's
  // obvious which weeks actually have anything in them before jumping there.
  counts?: Record<number, number>
}

// Calendar-style single-week navigation for the ledger — replaces stacking
// every week's table on top of each other, which read as one long undifferentiated
// scroll. Mirrors the week picker already used in ExportWeekModal.tsx.
export default function WeekNavigator({ projectCreatedAt, currentWeekNumber, selectedWeek, onChange, counts }: Props) {
  const bounds = projectWeekBounds(projectCreatedAt, selectedWeek)
  const weekOptions = Array.from({ length: currentWeekNumber }, (_, i) => currentWeekNumber - i) // descending

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onChange(selectedWeek - 1)}
        disabled={selectedWeek <= 1}
        className="w-7 h-7 rounded-full border border-[#e5e3df] bg-white flex items-center justify-center text-gray-500 hover:border-gray-300 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        aria-label="Previous week"
      >
        <ChevronLeft size={14} />
      </button>

      <select
        value={selectedWeek}
        onChange={e => onChange(Number(e.target.value))}
        className="text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg pl-3 pr-2 py-1.5 hover:border-gray-300 transition-colors"
      >
        {weekOptions.map(n => {
          const b = projectWeekBounds(projectCreatedAt, n)
          const count = counts?.[n] ?? 0
          return (
            <option key={n} value={n}>
              Week {n} · {b.start} – {b.end}{n === currentWeekNumber ? ' (current)' : ''} — {count}
            </option>
          )
        })}
      </select>

      <button
        onClick={() => onChange(selectedWeek + 1)}
        disabled={selectedWeek >= currentWeekNumber}
        className="w-7 h-7 rounded-full border border-[#e5e3df] bg-white flex items-center justify-center text-gray-500 hover:border-gray-300 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        aria-label="Next week"
      >
        <ChevronRight size={14} />
      </button>

      <span className="text-[11px] text-gray-400">{bounds.start} – {bounds.end}</span>
    </div>
  )
}
