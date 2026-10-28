'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { BEFORE_FIRST_WEEK, projectWeekBounds } from '@/lib/finance-weeks'

interface Props {
  // The date week 1 is counted from (projectWeekAnchor in finance-weeks.ts).
  weekAnchor: string
  // The project's own "now" week — the ceiling on how far Next can go, and
  // which option in the dropdown gets the "(current)" label. Same
  // Monday–Sunday week convention as ExportWeekModal (see finance-weeks.ts).
  currentWeekNumber: number
  selectedWeek: number
  onChange: (week: number) => void
  // Optional per-week transaction count, shown in the dropdown so it's
  // obvious which weeks actually have anything in them before jumping there.
  // Rows dated before week 1 are counted under BEFORE_FIRST_WEEK.
  counts?: Record<number, number>
  // Adds an "All weeks" option, reported to onChange as ALL_WEEKS — so the
  // whole history can be sorted/reviewed at once rather than week by week.
  allowAll?: boolean
}

export const ALL_WEEKS = 0

// Calendar-style single-week navigation for the ledger — replaces stacking
// every week's table on top of each other, which read as one long undifferentiated
// scroll. Mirrors the week picker already used in ExportWeekModal.tsx.
export default function WeekNavigator({ weekAnchor, currentWeekNumber, selectedWeek, onChange, counts, allowAll }: Props) {
  const showingAll = selectedWeek === ALL_WEEKS
  const showingEarlier = selectedWeek === BEFORE_FIRST_WEEK
  const bounds = showingAll || showingEarlier ? null : projectWeekBounds(weekAnchor, selectedWeek)
  const firstWeekStart = projectWeekBounds(weekAnchor, 1).start
  const totalCount = Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0)
  const earlierCount = counts?.[BEFORE_FIRST_WEEK] ?? 0
  const hasEarlier = earlierCount > 0 || showingEarlier
  const weekOptions = Array.from({ length: currentWeekNumber }, (_, i) => currentWeekNumber - i) // descending

  // "Before week 1" sits just before week 1, so stepping back from week 1
  // lands there when it has anything in it.
  const prevWeek = selectedWeek === 1 && hasEarlier ? BEFORE_FIRST_WEEK : selectedWeek - 1
  const nextWeek = showingEarlier ? 1 : selectedWeek + 1
  const prevDisabled = showingAll || showingEarlier || (selectedWeek <= 1 && !hasEarlier)
  const nextDisabled = showingAll || (!showingEarlier && selectedWeek >= currentWeekNumber)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onChange(prevWeek)}
        disabled={prevDisabled}
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
        {allowAll && <option value={ALL_WEEKS}>All weeks — {totalCount}</option>}
        {weekOptions.map(n => {
          const b = projectWeekBounds(weekAnchor, n)
          const count = counts?.[n] ?? 0
          return (
            <option key={n} value={n}>
              Week {n} · {b.start} – {b.end}{n === currentWeekNumber ? ' (current)' : ''} — {count}
            </option>
          )
        })}
        {hasEarlier && <option value={BEFORE_FIRST_WEEK}>Before week 1 · before {firstWeekStart} — {earlierCount}</option>}
      </select>

      <button
        onClick={() => onChange(nextWeek)}
        disabled={nextDisabled}
        className="w-7 h-7 rounded-full border border-[#e5e3df] bg-white flex items-center justify-center text-gray-500 hover:border-gray-300 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        aria-label="Next week"
      >
        <ChevronRight size={14} />
      </button>

      {bounds && <span className="text-[11px] text-gray-400">Mon {bounds.start} – Sun {bounds.end}</span>}
      {showingEarlier && <span className="text-[11px] text-gray-400">Dated before week 1 (starts Mon {firstWeekStart})</span>}
    </div>
  )
}
