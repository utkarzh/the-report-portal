'use client'

import { useState } from 'react'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'

// One shared "generating" mark used across every stage of the flow — a
// designed Lottie animation instead of a hand-rolled CSS/Framer Motion
// effect. Picks randomly between the two provided animations each time the
// loader appears, and re-tints whatever colors are baked into the source file
// to the app's golden theme, since neither source ships in brand colors.
type Variant = 'research' | 'points' | 'planteo' | 'final'

// Brand gold, same value used elsewhere in the app (EntityCard, transcription
// indicators, etc.) — kept as one constant so the loader always matches it.
const GOLD = '#c8973f'

const LOTTIE_SOURCES = ['/animations/cooking-preloader.lottie', '/animations/ai.lottie']

const HINTS: Record<Variant, string[]> = {
  research: [
    'Cross-referencing multiple sources…',
    'Checking dates, figures, and names for accuracy…',
    'Filtering out anything off-topic…',
    'Structuring findings into clear sections…',
    'Polishing the language…',
  ],
  points: [
    'Reviewing the accepted research…',
    'Identifying the strongest commercial angles…',
    'Drafting three sharp presentation points…',
    'Weighing each point for impact…',
    'Tightening the language…',
  ],
  planteo: [
    'Reviewing the presentation points…',
    'Shaping the opening lines…',
    'Writing natural, spoken phrasing…',
    'Matching the tone to the audience…',
    'Reading it back for flow…',
  ],
  final: [
    'Pulling together every accepted section…',
    'Applying the required document structure…',
    'Checking every claim is sourced…',
    'Formatting the final layout…',
    'Running a final quality pass…',
  ],
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

function GeneratingEmblem() {
  // Lazy initializer — picked once per mount, so each time the loader
  // appears (a new stage starting, a new regenerate) it re-rolls, rather
  // than picking once for the whole session or re-rolling on every render.
  const [src] = useState(() => LOTTIE_SOURCES[Math.floor(Math.random() * LOTTIE_SOURCES.length)])
  return (
    <div className="relative h-36 w-36 overflow-hidden">
      {/* Flatten the source animation to a pure luminance map, then tint it
          with mix-blend-mode: color — the overlay's hue/saturation (gold)
          replaces the base's, while the base's luminosity (the animation's
          actual shading) is kept. This reads as gold regardless of whatever
          colors are baked into the source .lottie file, and unlike an SVG
          filter referenced via `filter: url(#id)`, mix-blend-mode has none of
          that technique's cross-browser flakiness. */}
      <div className="absolute inset-0" style={{ filter: 'grayscale(1) contrast(1.1)' }}>
        <DotLottieReact src={src} loop autoplay />
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: GOLD, mixBlendMode: 'color' }} />
    </div>
  )
}

export default function MeetingPrepLoader({
  label,
  elapsedSecs,
  variant = 'research',
}: {
  label: string
  elapsedSecs: number
  variant?: Variant
}) {
  const hints = HINTS[variant]
  const hint = hints[Math.min(Math.floor(elapsedSecs / 6), hints.length - 1)]

  return (
    <div className="flex flex-col items-center justify-center gap-6 rounded-2xl border border-[#e5e3df] bg-white p-10 text-center shadow-sm">
      <GeneratingEmblem />

      <div className="space-y-2">
        <p key={label} className="fade-up text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-500 transition-opacity duration-500">{hint}</p>
        <p className="text-[11px] font-medium tabular-nums text-gray-400">{fmt(elapsedSecs)} elapsed</p>
      </div>
    </div>
  )
}
