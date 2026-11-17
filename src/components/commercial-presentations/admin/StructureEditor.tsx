'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  BLOCK_TYPE_OPTIONS,
  BUILT_IN_VARIABLES,
  normalizeVarKey,
  renderPresentation,
  validateStructure,
} from '@/lib/commercial-presentations'
import type { PresentationMasterContentRow, PresentationStructure } from '@/types'
import PresentationView from '../PresentationView'
import { Card, CardHeader, FieldLabel, inputClass } from '../ui'
import SegmentsEditor from './SegmentsEditor'
import { MasterSaveBar, MasterVersionHistory, useMasterContent } from './MasterContent'

// The presentation structure (brief §6): the blocks, their order and type,
// the locked methodology / master templates inside them, and the manual
// fields the team fills in. "The structure can eventually become
// configurable by Admin" — it is, from day one, without a workflow builder.

const parse = (c: unknown): PresentationStructure => {
  const v = validateStructure(c)
  return v.ok ? v.value : { blocks: [], manualFields: [] }
}

const SAMPLE_PROJECT = {
  agency_name: 'The Report Company',
  media_name: 'USA Today',
  country: 'Kazakhstan',
  anchor_event: 'the G20 Summit in Miami',
  anchor_date: 'November 2026',
}

export default function StructureEditor({ initialRow }: { initialRow: PresentationMasterContentRow | null }) {
  const m = useMasterContent<PresentationStructure>({
    kind: 'structure',
    initialRow,
    initialValue: parse(initialRow?.content),
    parse,
  })
  const [labels, setLabels] = useState<string[]>([])
  const onLabels = useCallback((l: string[]) => setLabels(l), [])
  const [withAnchor, setWithAnchor] = useState(true)
  const s = m.value
  const setS = (next: PresentationStructure) => m.setValue(next)

  const variables = useMemo(
    () => [...BUILT_IN_VARIABLES.map((v) => v.key), ...s.manualFields.map((f) => normalizeVarKey(f.key))].filter(Boolean),
    [s.manualFields],
  )

  const preview = useMemo(() => {
    const manual: Record<string, string> = {}
    for (const f of s.manualFields) manual[normalizeVarKey(f.key)] = f.placeholder.replace(/^e\.g\.\s*/i, '') || f.label
    return renderPresentation({
      structure: s,
      agencyContent: null,
      mediaMarket: 'the United States',
      mediaContent: { mediaMarket: '', sections: [{ id: 'p', title: '', segments: [{ id: 'p', kind: 'say', text: '(The selected media’s approved script appears here.)' }] }] },
      project: { ...SAMPLE_PROJECT, anchor_event: withAnchor ? SAMPLE_PROJECT.anchor_event : '' },
      manualInputs: manual,
      whyNowText: '(The selected AI-written Why [COUNTRY] Now appears here.)',
    }).blocks
  }, [s, withAnchor])

  const updateBlock = (i: number, patch: Partial<PresentationStructure['blocks'][number]>) =>
    setS({ ...s, blocks: s.blocks.map((b, n) => (n === i ? { ...b, ...patch } : b)) })
  const moveBlock = (i: number, d: -1 | 1) => {
    const blocks = [...s.blocks]
    const j = i + d
    if (j < 0 || j >= blocks.length) return
    ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
    setS({ ...s, blocks })
  }
  const updateField = (i: number, patch: Partial<PresentationStructure['manualFields'][number]>) =>
    setS({ ...s, manualFields: s.manualFields.map((f, n) => (n === i ? { ...f, ...patch } : f)) })

  return (
    <div className="flex flex-col gap-6">
      {s.blocks.map((b, i) => (
        <Card key={b.key + i}>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <span className="pb-2 text-sm font-semibold text-gray-400">{i + 1}.</span>
            <div className="min-w-[14rem] flex-1">
              <FieldLabel>Block title</FieldLabel>
              <input className={inputClass} value={b.title} onChange={(e) => updateBlock(i, { title: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <select className={inputClass} value={b.type} onChange={(e) => updateBlock(i, { type: e.target.value as typeof b.type })}>
                {BLOCK_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[12rem]">
              <FieldLabel>Badge</FieldLabel>
              <input className={inputClass} value={b.typeLabel} placeholder="e.g. Locked methodology" onChange={(e) => updateBlock(i, { typeLabel: e.target.value })} />
            </div>
            <span className="flex gap-1 pb-1.5">
              <button type="button" aria-label="Move block up" onClick={() => moveBlock(i, -1)} className="p-1.5 text-gray-400 hover:text-black">
                <ArrowUp size={15} />
              </button>
              <button type="button" aria-label="Move block down" onClick={() => moveBlock(i, 1)} className="p-1.5 text-gray-400 hover:text-black">
                <ArrowDown size={15} />
              </button>
              <button type="button" aria-label="Delete block" onClick={() => setS({ ...s, blocks: s.blocks.filter((_, n) => n !== i) })} className="p-1.5 text-gray-300 hover:text-red-500">
                <Trash2 size={15} />
              </button>
            </span>
          </div>
          <p className="mb-3 text-xs text-gray-500">{BLOCK_TYPE_OPTIONS.find((o) => o.value === b.type)?.help}</p>
          {b.type === 'media' ? (
            <p className="text-xs text-gray-500">Each publication&apos;s script is edited under Media scripts.</p>
          ) : (
            <SegmentsEditor segments={b.segments} onChange={(segments) => updateBlock(i, { segments })} variables={variables} />
          )}
        </Card>
      ))}

      <button
        type="button"
        onClick={() => setS({ ...s, blocks: [...s.blocks, { key: `block_${Date.now()}`, title: 'New block', type: 'template', typeLabel: 'Master content', segments: [] }] })}
        className="inline-flex items-center gap-1.5 self-start rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:border-gray-500 hover:text-black"
      >
        <Plus size={14} /> Add block
      </button>

      <Card>
        <CardHeader title="Manual fields" description="What the team fills in for each project. Each field is a variable: a field with key MAIN SECTORS fills [MAIN SECTORS] in the templates." />
        <div className="flex flex-col gap-3">
          {s.manualFields.map((f, i) => (
            <div key={i} className="grid items-end gap-3 rounded-xl border border-[#e5e3df] p-3 md:grid-cols-[1fr_1.4fr_1.6fr_auto]">
              <div>
                <FieldLabel>Variable key</FieldLabel>
                <input className={inputClass} value={f.key} onChange={(e) => updateField(i, { key: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <FieldLabel>Label</FieldLabel>
                <input className={inputClass} value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} />
              </div>
              <div>
                <FieldLabel>Placeholder</FieldLabel>
                <input className={inputClass} value={f.placeholder} onChange={(e) => updateField(i, { placeholder: e.target.value })} />
              </div>
              <div className="flex items-center gap-3 pb-2 text-xs text-gray-600">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} /> Required
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={f.multiline} onChange={(e) => updateField(i, { multiline: e.target.checked })} /> Long
                </label>
                <button type="button" aria-label="Delete field" onClick={() => setS({ ...s, manualFields: s.manualFields.filter((_, n) => n !== i) })} className="p-1 text-gray-300 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setS({ ...s, manualFields: [...s.manualFields, { key: 'NEW FIELD', label: 'New field', placeholder: '', required: false, multiline: false }] })}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:border-gray-500 hover:text-black"
          >
            <Plus size={12} /> Add field
          </button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Preview"
          description="Rendered with sample values (The Report Company · USA Today · Kazakhstan)."
          action={
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={withAnchor} onChange={(e) => setWithAnchor(e.target.checked)} /> With an anchor event
            </label>
          }
        />
        <PresentationView blocks={preview} />
      </Card>

      <MasterVersionHistory
        master={m}
        onLabels={onLabels}
        summarize={(c) => {
          const p = parse(c)
          return `${p.blocks.length} blocks: ${p.blocks.map((b) => b.title).join(' · ')}`
        }}
      />
      <MasterSaveBar liveVersion={m.row?.version_label ?? null} versionLabels={labels} dirty={m.dirty} saving={m.saving} error={m.error} onSave={m.save} isNew={!m.row} />
    </div>
  )
}
