import type { ReactNode } from 'react'

export type PillTone = 'emerald' | 'amber' | 'red' | 'sky' | 'stone'

const TONE_CLASSES: Record<PillTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  sky: 'bg-sky-50 text-sky-700',
  stone: 'bg-stone-50 text-stone-600',
}

const DOT_CLASSES: Record<PillTone, string> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  sky: 'bg-sky-500',
  stone: 'bg-stone-400',
}

// Small state indicator used on entity list cards (stage, transcription
// status, token usage, ...) — one shared pill so every list gets the same
// shape/tone mapping instead of each page hand-rolling its own.
export default function StatusPill({ label, tone, icon, pulse }: { label: string; tone: PillTone; icon?: ReactNode; pulse?: boolean }) {
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${TONE_CLASSES[tone]}`}>
      {icon ?? <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]} ${pulse ? 'animate-pulse' : ''}`} />}
      {label}
    </span>
  )
}
