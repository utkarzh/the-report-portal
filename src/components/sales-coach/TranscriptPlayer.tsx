'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Copy, Check, Maximize2, Minimize2, Play } from 'lucide-react'
import { useStickToBottom } from '@/lib/use-stick-to-bottom'
import { formatTimestamp } from '@/lib/sales-coach'
import type { SalesCoachTranscriptSegment } from '@/types'

// The negotiation transcript, line by line, each with a clickable timestamp
// that seeks the (single, persistent) audio player to that exact moment — the
// client's specific request. Only possible when AssemblyAI produced structured
// segments (an uploaded recording); a pasted transcript has no audio to seek
// into and falls back to the old flat, scrollable text view.
export default function TranscriptPlayer({
  segments,
  fallbackText,
  source,
  activeMs,
  onTimestampClick,
}: {
  segments: SalesCoachTranscriptSegment[] | null
  fallbackText: string | null
  source: 'system' | 'uploaded' | null
  // Current audio playback position (ms), for highlighting the active line.
  // Omit or pass undefined when no audio is playing.
  activeMs?: number
  onTimestampClick?: (ms: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const hasSegments = Boolean(segments && segments.length > 0 && onTimestampClick)
  const flatText = fallbackText
  const words = flatText ? flatText.split(/\s+/).filter(Boolean).length : (segments || []).reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0)

  const scroll = useStickToBottom<HTMLDivElement>((segments?.length ?? 0) + (flatText?.length ?? 0))
  const activeRef = useRef<HTMLDivElement | null>(null)

  // Keep the active line in view while it's the one being scrolled by the
  // hook above — a gentle nudge, not a hijack of manual scrolling.
  useEffect(() => {
    if (!hasSegments || activeMs === undefined) return
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [hasSegments, activeMs])

  async function copyAll() {
    const text = flatText || (segments || []).map((s) => `[${formatTimestamp(s.start_ms)}] Speaker ${s.speaker}: ${s.text}`).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const activeIndex = hasSegments && activeMs !== undefined
    ? findActiveIndex(segments!, activeMs)
    : -1

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
          <FileText size={13} /> Transcript
          {source && (
            <span className="rounded-full bg-[#f2f1ec] px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-gray-500">
              {source === 'system' ? 'Transcribed with speaker labels' : 'Uploaded by the executive'}{words > 0 ? ` · ${words.toLocaleString()} words` : ''}
            </span>
          )}
          {hasSegments && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#fbf7ed] px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[#a07530]">
              <Play size={9} className="fill-current" /> Click a time to listen
            </span>
          )}
        </p>
        {(flatText || hasSegments) && (
          <div className="flex items-center gap-1">
            <button onClick={copyAll} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900">
              {copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900">
              {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}<span>{expanded ? 'Collapse' : 'Expand'}</span>
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-[#e5e3df] bg-[#faf9f7]">
        <div
          ref={scroll.ref}
          onScroll={scroll.onScroll}
          onWheel={scroll.onWheel}
          className={`overflow-y-auto px-1 py-2 ${expanded ? 'max-h-none' : 'max-h-[440px]'}`}
        >
          {hasSegments ? (
            <div className="flex flex-col">
              {segments!.map((seg, i) => (
                <div
                  key={i}
                  ref={i === activeIndex ? activeRef : undefined}
                  className={`flex gap-3 rounded-lg px-3 py-2 transition-colors ${i === activeIndex ? 'bg-[#fbf7ed]' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => onTimestampClick!(seg.start_ms)}
                    title="Play from here"
                    className={`mt-0.5 flex h-6 flex-shrink-0 items-center gap-1 rounded-full px-2 font-mono text-[11px] font-medium tabular-nums transition-colors ${
                      i === activeIndex ? 'bg-[#c8973f] text-white' : 'bg-white text-gray-500 ring-1 ring-[#e5e3df] hover:bg-black hover:text-white hover:ring-black'
                    }`}
                  >
                    <Play size={9} className="fill-current" />
                    {formatTimestamp(seg.start_ms)}
                  </button>
                  <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                    <span className="mr-1.5 font-semibold text-gray-500">Speaker {seg.speaker}:</span>
                    {seg.text}
                  </p>
                </div>
              ))}
            </div>
          ) : flatText ? (
            <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-7 text-gray-700">{flatText}</p>
          ) : (
            <p className="px-4 py-3 text-sm text-gray-400">No transcript yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// The last segment whose start is at or before `ms` — i.e. the line playing
// right now. Segments are already in chronological order.
function findActiveIndex(segments: SalesCoachTranscriptSegment[], ms: number): number {
  let idx = -1
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start_ms <= ms) idx = i
    else break
  }
  return idx
}
