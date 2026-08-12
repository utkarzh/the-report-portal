'use client'

import { Search } from 'lucide-react'

// Mirrors TranscribingLoader's shape (icon + elapsed clock + rotating hint)
// so every long-running AI step in the app feels like one flow, but the
// primary line stays tied to the real SSE status the server sends (e.g.
// "Searching the web…") — the rotating hint below it only fills the dead
// air between those real updates, it never replaces them.
const AMBIENT_HINTS = [
  'Cross-referencing multiple sources…',
  'Checking dates, figures, and names for accuracy…',
  'Filtering out anything off-topic…',
  'Structuring findings into clear sections…',
  'Polishing the language…',
]

function fmt(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

export default function MeetingPrepLoader({ label, elapsedSecs }: { label: string; elapsedSecs: number }) {
  const hint = AMBIENT_HINTS[Math.min(Math.floor(elapsedSecs / 6), AMBIENT_HINTS.length - 1)]

  return (
    <div className="flex flex-col items-center justify-center gap-6 rounded-2xl border border-[#e5e3df] bg-white p-10 text-center shadow-sm">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-[#c8973f]/10 animate-ping" style={{ animationDuration: '2.4s' }} />
        <span className="absolute inset-3 rounded-full bg-[#c8973f]/10" />
        <Search size={22} className="relative animate-[spin_5s_linear_infinite] text-[#a07530]" />
      </div>

      <div className="space-y-2">
        <p key={label} className="fade-up text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-500 transition-opacity duration-500">{hint}</p>
        <p className="text-[11px] font-medium tabular-nums text-gray-400">{fmt(elapsedSecs)} elapsed</p>
      </div>
    </div>
  )
}
