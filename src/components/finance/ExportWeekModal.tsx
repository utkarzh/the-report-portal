'use client'

import { useMemo, useState } from 'react'
import { X, Download } from 'lucide-react'
import { projectWeekBounds, projectWeekNumberForDate } from '@/lib/finance-weeks'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  projectCreatedAt: string
}

// Downloads the caja Excel for a chosen week — a plain navigation, not a
// fetch+blob dance, since the browser already sends the auth cookie and the
// route sets Content-Disposition: attachment.
//
// Weeks here are strict to the project's own creation date (see
// lib/finance-weeks.ts), not calendar weeks — "Week 1" always means "the
// first 7 days of this project," full stop. The dropdown lists every elapsed
// week in descending order; picking one fills the date range to match
// exactly. If the dates are then hand-edited to something that doesn't line
// up with any single project week, this becomes a "Custom" export instead —
// still fully supported, just not labelled as a specific week.
export default function ExportWeekModal({ open, onClose, projectId, projectCreatedAt }: Props) {
  const currentWeekNumber = useMemo(
    () => projectWeekNumberForDate(projectCreatedAt, new Date()),
    [projectCreatedAt],
  )
  const weekOptions = useMemo(
    () => Array.from({ length: currentWeekNumber }, (_, i) => currentWeekNumber - i), // descending
    [currentWeekNumber],
  )

  const initial = projectWeekBounds(projectCreatedAt, currentWeekNumber)
  const [weekStart, setWeekStart] = useState(initial.start)
  const [weekEnd, setWeekEnd] = useState(initial.end)

  const matchedWeek = useMemo(() => {
    for (const n of weekOptions) {
      const b = projectWeekBounds(projectCreatedAt, n)
      if (b.start === weekStart && b.end === weekEnd) return n
    }
    return null
  }, [weekStart, weekEnd, weekOptions, projectCreatedAt])

  const label = matchedWeek ? `Week ${matchedWeek}` : 'Custom'

  function selectWeek(n: number) {
    const b = projectWeekBounds(projectCreatedAt, n)
    setWeekStart(b.start)
    setWeekEnd(b.end)
  }

  if (!open) return null

  const href = `/api/finance/projects/${projectId}/export?weekStart=${weekStart}&weekEnd=${weekEnd}&label=${encodeURIComponent(label)}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-sm shadow-2xl rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Export week (Excel)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Week</label>
            <select
              className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2"
              value={matchedWeek ?? ''}
              onChange={e => selectWeek(Number(e.target.value))}
            >
              {!matchedWeek && <option value="" disabled>Custom range (edit dates below)</option>}
              {weekOptions.map(n => (
                <option key={n} value={n}>Week {n}{n === currentWeekNumber ? ' (current)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">From</label>
              <input type="date" className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={weekStart} onChange={e => setWeekStart(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">To</label>
              <input type="date" className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={weekEnd} onChange={e => setWeekEnd(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            {matchedWeek
              ? `Week ${matchedWeek} — strict to this project's own start date, not the calendar week.`
              : "Custom range — doesn't line up with a single project week, exported as-is."}
          </p>
          <a
            href={href}
            onClick={onClose}
            className="text-sm font-medium bg-black text-white rounded-lg px-4 py-2.5 text-center hover:opacity-85 flex items-center justify-center gap-1.5"
          >
            <Download size={14} /> Download .xlsx ({label})
          </a>
        </div>
      </div>
    </div>
  )
}
