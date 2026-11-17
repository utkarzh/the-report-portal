'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { newSegmentId, SEGMENT_KIND_LABELS } from '@/lib/commercial-presentations'
import type { PresentationSegment, PresentationSegmentKind } from '@/types'
import { inputClass } from '../ui'

// Edits a list of SAY / ACTION / NOTE segments — the building block of every
// master content piece. Variables use the brief's [VARIABLE] syntax; a
// segment can be shown only when a variable has a value (or only when it's
// empty), which is how "with / without anchor event" wording is configured
// without any code.

type Condition = 'always' | 'showIf' | 'hideIf'

function conditionOf(s: PresentationSegment): { mode: Condition; key: string } {
  if (s.showIf) return { mode: 'showIf', key: s.showIf }
  if (s.hideIf) return { mode: 'hideIf', key: s.hideIf }
  return { mode: 'always', key: '' }
}

export default function SegmentsEditor({
  segments,
  onChange,
  variables,
}: {
  segments: PresentationSegment[]
  onChange: (next: PresentationSegment[]) => void
  /** Variable names available to these templates, shown as insertable chips. */
  variables: string[]
}) {
  const update = (i: number, patch: Partial<PresentationSegment>) => onChange(segments.map((s, n) => (n === i ? { ...s, ...patch } : s)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...segments]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const setCondition = (i: number, mode: Condition, key: string) => {
    const s = { ...segments[i] }
    delete s.showIf
    delete s.hideIf
    if (mode === 'showIf' && key) s.showIf = key
    if (mode === 'hideIf' && key) s.hideIf = key
    onChange(segments.map((x, n) => (n === i ? s : x)))
  }

  return (
    <div className="flex flex-col gap-3">
      {segments.length === 0 && <p className="text-xs text-gray-500">No segments yet.</p>}
      {segments.map((s, i) => {
        const cond = conditionOf(s)
        return (
          <div key={s.id} className="rounded-xl border border-[#e5e3df] bg-[#fcfbf9] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select
                aria-label="Segment type"
                className="rounded-lg border border-[#e5e3df] bg-white px-2 py-1 text-xs font-semibold"
                value={s.kind}
                onChange={(e) => update(i, { kind: e.target.value as PresentationSegmentKind })}
              >
                {(Object.keys(SEGMENT_KIND_LABELS) as PresentationSegmentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {SEGMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <input
                aria-label="Sub-heading"
                className="min-w-[10rem] flex-1 rounded-lg border border-[#e5e3df] bg-white px-2 py-1 text-xs"
                placeholder="Optional sub-heading (e.g. Seating)"
                value={s.heading || ''}
                onChange={(e) => update(i, { heading: e.target.value || undefined })}
              />
              <select
                aria-label="Show condition"
                className="rounded-lg border border-[#e5e3df] bg-white px-2 py-1 text-xs"
                value={cond.mode}
                onChange={(e) => setCondition(i, e.target.value as Condition, cond.key || variables[0] || '')}
              >
                <option value="always">Always shown</option>
                <option value="showIf">Only if … has a value</option>
                <option value="hideIf">Only if … is empty</option>
              </select>
              {cond.mode !== 'always' && (
                <select aria-label="Condition variable" className="rounded-lg border border-[#e5e3df] bg-white px-2 py-1 text-xs" value={cond.key} onChange={(e) => setCondition(i, cond.mode, e.target.value)}>
                  {variables.map((v) => (
                    <option key={v} value={v}>
                      [{v}]
                    </option>
                  ))}
                </select>
              )}
              <span className="ml-auto flex gap-1">
                <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="p-1 text-gray-400 hover:text-black">
                  <ArrowUp size={14} />
                </button>
                <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="p-1 text-gray-400 hover:text-black">
                  <ArrowDown size={14} />
                </button>
                <button type="button" aria-label="Delete segment" onClick={() => onChange(segments.filter((_, n) => n !== i))} className="p-1 text-gray-300 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
            <textarea
              aria-label="Segment text"
              rows={Math.min(8, Math.max(2, Math.ceil(s.text.length / 110)))}
              className={inputClass}
              value={s.text}
              placeholder={s.kind === 'say' ? 'The words the salesperson says…' : s.kind === 'action' ? 'What the salesperson does…' : 'A note for the salesperson…'}
              onChange={(e) => update(i, { text: e.target.value })}
            />
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-2">
        {(['say', 'action', 'note'] as PresentationSegmentKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange([...segments, { id: newSegmentId(), kind: k, text: '' }])}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:border-gray-500 hover:text-black"
          >
            <Plus size={12} /> {SEGMENT_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      {variables.length > 0 && (
        <p className="text-[11px] text-gray-500">
          Variables: {variables.map((v) => `[${v}]`).join(' ')}. Anything else in brackets, such as [NAME], is left for the salesperson to fill in live.
        </p>
      )}
    </div>
  )
}
