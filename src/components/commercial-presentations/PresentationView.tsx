'use client'

import { Fragment } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { splitPlaceholders } from '@/lib/commercial-presentation-export'
import type { RenderedBlock, RenderedSegment } from '@/types'

// The presentation as the salesperson will rehearse it: numbered blocks, each
// made of SAY (the words), ACTION (what to do) and NOTE segments, clearly
// distinguished (brief §7). Unfilled [PLACEHOLDERS] are highlighted. Shared
// by the draft review, the approved snapshot view and the admin preview.

function Text({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((p, i) =>
        p.placeholder ? (
          <mark key={i} className="rounded bg-yellow-100 px-0.5 text-yellow-900">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  )
}

function Segment({ seg }: { seg: RenderedSegment }) {
  return (
    <div className="flex flex-col gap-1">
      {seg.section && (
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-800">
          <Text text={seg.section} />
        </p>
      )}
      {seg.heading && (
        <p className="text-xs font-semibold text-gray-700">
          <Text text={seg.heading} />
        </p>
      )}
      {seg.kind === 'say' ? (
        <div className={`border-l-2 pl-3 text-sm leading-relaxed text-gray-900 ${seg.source === 'ai' ? 'border-violet-500' : 'border-gray-900'}`}>
          <span className="mr-2 align-middle text-[9px] font-bold uppercase tracking-widest text-gray-400">Say</span>
          “<Text text={seg.text} />”
        </div>
      ) : seg.kind === 'action' ? (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
          <span className="mr-2 text-[9px] font-bold uppercase tracking-widest text-amber-700">Action</span>
          <span className="italic">
            <Text text={seg.text} />
          </span>
        </div>
      ) : (
        <p className="pl-3 text-xs italic leading-relaxed text-gray-500">
          <Text text={seg.text} />
        </p>
      )}
    </div>
  )
}

export default function PresentationView({
  blocks,
  emptyHint,
  showBlockHeaders = true,
}: {
  blocks: RenderedBlock[]
  emptyHint?: string
  /** Off for previews of a single piece of content (e.g. an agency profile). */
  showBlockHeaders?: boolean
}) {
  if (blocks.length === 0) {
    return <p className="text-sm text-gray-500">{emptyHint || 'No blocks are configured yet.'}</p>
  }
  return (
    <ol className="flex flex-col gap-6">
      {blocks.map((block) => (
        <li key={block.key} className="flex flex-col gap-3">
          {showBlockHeaders && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[#efede9] pb-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
              {block.number}. {block.title}
            </h3>
            {block.typeLabel && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  block.type === 'why_now' ? 'bg-violet-50 text-violet-700' : 'bg-stone-100 text-stone-600'
                }`}
              >
                {block.type === 'why_now' ? <Sparkles size={10} /> : <Lock size={10} />}
                {block.typeLabel}
              </span>
            )}
          </div>
          )}
          {block.segments.length === 0 ? (
            <p className="text-xs text-gray-400">Nothing to show in this block yet.</p>
          ) : (
            block.segments.map((seg, i) => <Segment key={i} seg={seg} />)
          )}
        </li>
      ))}
    </ol>
  )
}
