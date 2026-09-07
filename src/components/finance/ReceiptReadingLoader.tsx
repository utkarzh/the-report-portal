'use client'

import { useEffect, useState } from 'react'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'

// Same designed-Lottie + gold-tint technique as MeetingPrepLoader (see that
// file for why: a real animation reads as "something is happening" far
// better than a static line of text, and the two source files already ship
// in the app for that purpose). Kept as its own small component rather than
// generalizing MeetingPrepLoader — this one runs its own elapsed-time clock
// since a single receipt-extraction call has no external progress signal to
// key off, unlike the multi-stage meeting-prep flow.
const GOLD = '#c8973f'
const LOTTIE_SOURCES = ['/animations/cooking-preloader.lottie', '/animations/ai.lottie']

const HINTS = [
  'Reading the receipt…',
  'Making out the vendor and date…',
  'Working out the amount and currency…',
  'Checking the numbers against the exchange rate…',
  'Picking the closest expense category…',
  'Almost there…',
]

function GeneratingEmblem() {
  const [src] = useState(() => LOTTIE_SOURCES[Math.floor(Math.random() * LOTTIE_SOURCES.length)])
  return (
    <div className="relative h-28 w-28 overflow-hidden">
      <div className="absolute inset-0" style={{ filter: 'grayscale(1) contrast(1.1)' }}>
        <DotLottieReact src={src} loop autoplay />
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: GOLD, mixBlendMode: 'color' }} />
    </div>
  )
}

interface Props {
  // Set when reading more than one receipt in a batch, to show which one is
  // in flight — the elapsed-time hints below still drive the per-file copy.
  batch?: { index: number; total: number; fileName: string }
}

export default function ReceiptReadingLoader({ batch }: Props) {
  const [elapsedSecs, setElapsedSecs] = useState(0)

  useEffect(() => {
    setElapsedSecs(0)
    const timer = setInterval(() => setElapsedSecs(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [batch?.index])

  const hint = HINTS[Math.min(Math.floor(elapsedSecs / 3), HINTS.length - 1)]

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
      <GeneratingEmblem />
      {batch && (
        <p className="text-xs font-semibold uppercase tracking-widest text-[#a07530]">
          Receipt {batch.index} of {batch.total} · {batch.fileName}
        </p>
      )}
      <p key={hint} className="fade-up text-sm font-medium text-gray-700">{hint}</p>
    </div>
  )
}
