'use client'

import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'

// A full brief or business case builds in stages and can take minutes before the
// first token arrives, so instead of a bare "Generating the editorial brief…"
// line we show the app's glowing emblem, a live elapsed clock, and gently
// rotating status hints — something to watch while the work happens.
// Mirrors TranscribingLoader's shape, using the Gemini-style emblem from the
// module's own "new" screen so the two feel like one flow.

const HINTS = [
  'Reading the brief and your inputs…',
  'Searching for current, well-sourced data…',
  'Cross-checking recent developments…',
  'Shaping the structure and sections…',
  'Drafting the opening sections…',
  'Building out the detail, section by section…',
  'Still writing — long documents come in stages…',
]

function fmt(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

export default function DocumentGeneratingLoader({ label }: { label: string }) {
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1_000)
    return () => clearInterval(t)
  }, [])

  // Rotate roughly every 8s, holding on the last ("still writing") hint.
  const hint = HINTS[Math.min(Math.floor(secs / 8), HINTS.length - 1)]

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12 text-center">
      {/* Glowing emblem — same language as the module's start screen */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="gemini-aurora absolute -inset-1 rounded-full opacity-70 blur-xl" />
        <div className="gemini-bloom absolute inset-1 rounded-full blur-2xl" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[#e5e3df] bg-white shadow-sm">
          <FileText size={20} className="gemini-sparkle text-gray-700" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-800">Writing your {label.toLowerCase()}</p>
        <p className="text-xs text-gray-500 transition-opacity duration-500">{hint}</p>
        <p className="text-[11px] font-medium tabular-nums text-gray-400">
          {fmt(secs)} elapsed · a full document builds in stages and can take a few minutes
        </p>
      </div>

      {/* Flowing progress line — indeterminate, matches the app's monochrome look */}
      <div className="flow-line h-[2px] w-40 rounded-full" />
    </div>
  )
}
