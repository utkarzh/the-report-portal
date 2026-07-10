'use client'

import { AudioLines } from 'lucide-react'

// The AssemblyAI job can run for a few minutes on long recordings, so instead
// of a bare "Transcribing…" line we show a calming animated waveform, a live
// elapsed clock, and gently rotating status hints — something pleasant to watch
// while the work happens in the background.

// A few bars of varying height/speed read as an audio waveform. Delays and
// durations are fixed (deterministic) so it animates smoothly without JS.
const BARS = [
  { h: 40, d: '0ms', dur: '1100ms' },
  { h: 70, d: '120ms', dur: '900ms' },
  { h: 100, d: '260ms', dur: '1300ms' },
  { h: 55, d: '80ms', dur: '1000ms' },
  { h: 85, d: '340ms', dur: '1200ms' },
  { h: 100, d: '180ms', dur: '850ms' },
  { h: 45, d: '300ms', dur: '1150ms' },
  { h: 75, d: '60ms', dur: '950ms' },
  { h: 60, d: '400ms', dur: '1250ms' },
]

const HINTS = [
  'Listening to the recording…',
  'Separating the audio into speakers…',
  'Transcribing what everyone said…',
  'Labelling Speaker A, Speaker B…',
  'Piecing the conversation together…',
  'Almost there — polishing the transcript…',
]

function fmt(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

export default function TranscribingLoader({ waitSecs }: { waitSecs: number }) {
  // Rotate the hint roughly every 4s — derived from the parent's clock so we
  // don't run a second timer. Hold on the last ("almost there") hint.
  const hint = HINTS[Math.min(Math.floor(waitSecs / 4), HINTS.length - 1)]

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-10 text-center">
      {/* Waveform inside a soft pulsing halo */}
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-[#c8973f]/10 animate-ping" style={{ animationDuration: '2.5s' }} />
        <span className="absolute inset-2 rounded-full bg-[#c8973f]/10" />
        <div className="relative flex h-12 items-end gap-[3px]">
          {BARS.map((b, i) => (
            <span
              key={i}
              className="wave-bar w-[3px] rounded-full bg-[#c8973f]"
              style={{ height: `${b.h}%`, animationDelay: b.d, animationDuration: b.dur }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 text-sm font-medium text-gray-800">
          <AudioLines size={15} className="text-[#c8973f]" />
          <span>Transcribing &amp; identifying speakers</span>
        </div>
        <p className="text-xs text-gray-500 transition-opacity duration-500">{hint}</p>
        <p className="text-[11px] font-medium tabular-nums text-gray-400">
          {fmt(waitSecs)} elapsed · this can take a few minutes for long recordings
        </p>
      </div>
    </div>
  )
}
