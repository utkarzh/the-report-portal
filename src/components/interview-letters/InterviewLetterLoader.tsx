'use client'

import { useState } from 'react'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'

// Same designed-Lottie + gold-tint technique as MeetingPrepLoader (see that
// file for the full rationale) — reused here rather than generalized into a
// shared component, matching how ReceiptReadingLoader was derived from it too.
type Variant = 'research' | 'letter' | 'email' | 'personalize'

const GOLD = '#c8973f'

const LOTTIE_SOURCES = ['/animations/cooking-preloader.lottie', '/animations/ai.lottie']

const HINTS: Record<Variant, string[]> = {
  research: [
    'Searching for letter-relevant facts…',
    'Checking for a live why-now hook…',
    'Verifying dates and sources…',
    'Filtering out anything off-topic…',
    'Structuring the findings…',
  ],
  letter: [
    'Loading the universal template…',
    'Adapting it to the project and media partner…',
    'Drafting each variable paragraph…',
    'Respecting the word budgets…',
    'Almost ready for review…',
  ],
  email: [
    'Reading the approved letter…',
    'Reducing it to the essentials…',
    'Keeping the strongest why-now hook…',
    'Tightening the language…',
    'Finishing the draft…',
  ],
  personalize: [
    'Reading the approved letter and email…',
    'Applying the recipient’s details…',
    'Adjusting tone and address conventions…',
    'Keeping the approved master untouched…',
    'Finishing the tailored draft…',
  ],
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

function GeneratingEmblem() {
  const [src] = useState(() => LOTTIE_SOURCES[Math.floor(Math.random() * LOTTIE_SOURCES.length)])
  return (
    <div className="relative h-36 w-36 overflow-hidden">
      <div className="absolute inset-0" style={{ filter: 'grayscale(1) contrast(1.1)' }}>
        <DotLottieReact src={src} loop autoplay />
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: GOLD, mixBlendMode: 'color' }} />
    </div>
  )
}

export default function InterviewLetterLoader({
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
