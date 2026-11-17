'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { knownVariableKeys, newSegmentId, renderSections } from '@/lib/commercial-presentations'
import type { MasterContentSection, RenderedBlock, RenderedSegment } from '@/types'
import PresentationView from '../PresentationView'
import { Card, CardHeader, FieldLabel, inputClass } from '../ui'
import SegmentsEditor from './SegmentsEditor'

// Titled sections of SAY / ACTION / NOTE lines, shared by agency profiles and
// media scripts: add, rename, reorder and delete sections, each with its own
// lines. The presentation uses every section in this order, each title as a
// sub-heading.

export function SectionsEditor({
  sections,
  onChange,
  variables,
  titlePlaceholder = 'e.g. Who we are',
}: {
  sections: MasterContentSection[]
  onChange: (next: MasterContentSection[]) => void
  variables: string[]
  titlePlaceholder?: string
}) {
  const update = (i: number, patch: Partial<MasterContentSection>) => onChange(sections.map((s, n) => (n === i ? { ...s, ...patch } : s)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= sections.length) return
    const next = [...sections]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <>
      {sections.map((section, i) => (
        <Card key={section.id}>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <span className="pb-2 text-sm font-semibold text-gray-400">{i + 1}.</span>
            <div className="min-w-[14rem] flex-1">
              <FieldLabel htmlFor={`section-${section.id}`}>Section title</FieldLabel>
              <input
                id={`section-${section.id}`}
                className={inputClass}
                value={section.title}
                placeholder={titlePlaceholder}
                onChange={(e) => update(i, { title: e.target.value })}
              />
            </div>
            <span className="flex gap-1 pb-1.5">
              <button type="button" aria-label="Move section up" onClick={() => move(i, -1)} className="p-1.5 text-gray-400 hover:text-black touch:p-2.5">
                <ArrowUp size={15} />
              </button>
              <button type="button" aria-label="Move section down" onClick={() => move(i, 1)} className="p-1.5 text-gray-400 hover:text-black touch:p-2.5">
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                aria-label="Delete section"
                onClick={() => onChange(sections.filter((_, n) => n !== i))}
                className="p-1.5 text-gray-300 hover:text-red-500 touch:p-2.5"
              >
                <Trash2 size={15} />
              </button>
            </span>
          </div>
          <SegmentsEditor segments={section.segments} onChange={(segments) => update(i, { segments })} variables={variables} />
        </Card>
      ))}

      <button
        type="button"
        onClick={() => onChange([...sections, { id: newSegmentId(), title: '', segments: [] }])}
        className="inline-flex items-center gap-1.5 self-start rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:border-gray-500 hover:text-black"
      >
        <Plus size={14} /> Add section
      </button>
    </>
  )
}

// The sections as a real presentation renders them, with sample values and
// an "anchor event" toggle for show-if / hide-if lines.
export function SectionsPreview({
  sections,
  sampleVars,
  source,
  description,
}: {
  sections: MasterContentSection[]
  sampleVars: Record<string, string>
  source: RenderedSegment['source']
  description: ReactNode
}) {
  const [withAnchor, setWithAnchor] = useState(true)
  const blocks = useMemo<RenderedBlock[]>(() => {
    const vars = { ...sampleVars, 'ANCHOR EVENT': withAnchor ? sampleVars['ANCHOR EVENT'] || '' : '' }
    const known = knownVariableKeys({ blocks: [], manualFields: [] })
    return [{ key: 'preview', number: 1, title: '', type: source === 'media' ? 'media' : 'agency', typeLabel: '', segments: renderSections(sections, vars, known, source) }]
  }, [sections, sampleVars, source, withAnchor])

  return (
    <Card>
      <CardHeader
        title="Preview"
        description={description}
        action={
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={withAnchor} onChange={(e) => setWithAnchor(e.target.checked)} /> With an anchor event
          </label>
        }
      />
      <PresentationView blocks={blocks} showBlockHeaders={false} />
    </Card>
  )
}
