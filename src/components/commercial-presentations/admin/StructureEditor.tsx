'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, FileUp, Loader2, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Link from 'next/link'
import {
  ADMIN_PATH,
  API_PATH,
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
  // "Build from a document": the parsed structure replaces the editor's
  // content as an unsaved draft; `undo` keeps what was there before.
  const [importing, setImporting] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [imported, setImported] = useState<{ fileName: string; blocks: number; fields: number; truncated: boolean; undo: PresentationStructure } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
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

  async function importFrom(file: File) {
    setPendingFile(null)
    setImporting(file.name)
    setImportError(null)
    setImported(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`${API_PATH}/master/structure-from-document`, { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not build a structure from that document.')
      const next = data.structure as PresentationStructure
      setImported({ fileName: data.fileName || file.name, blocks: next.blocks.length, fields: next.manualFields.length, truncated: !!data.truncated, undo: s })
      setS(next)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not build a structure from that document.')
    } finally {
      setImporting(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Build from a document"
          description="Upload the presentation script or methodology (.docx, .pdf, .txt or .md). Its blocks, their SAY / ACTION / NOTE lines (verbatim), the with / without anchor-event wording and the manual fields are read into the editor below as a draft. Nothing is saved until you press Save."
        />
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-800 shadow-sm transition-colors touch:py-3 hover:border-gray-400 ${
              importing ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {importing ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
            {importing ? 'Reading the document…' : 'Upload a document'}
            <input
              type="file"
              accept=".docx,.pdf,.txt,.md,.markdown"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                if (s.blocks.length > 0) setPendingFile(f)
                else void importFrom(f)
              }}
            />
          </label>
          {importing && <span className="text-xs text-gray-500">Reading {importing} — this can take a minute or two.</span>}
          <Link href={`${ADMIN_PATH}/structure/import-prompt`} className="ml-auto text-xs font-medium text-gray-500 underline-offset-2 hover:text-black hover:underline">
            Edit the reading instructions →
          </Link>
        </div>
        {importError && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{importError}</p>}
        {imported && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
            <CheckCircle2 size={13} />
            <span>
              Built {imported.blocks} block{imported.blocks === 1 ? '' : 's'} and {imported.fields} manual field{imported.fields === 1 ? '' : 's'} from{' '}
              <span className="font-medium">{imported.fileName}</span>. Check them below, then press Save.
              {imported.truncated && ' The document was long, so only its first part was read.'}
            </span>
            <button
              type="button"
              onClick={() => {
                setS(imported.undo)
                setImported(null)
              }}
              className="font-semibold underline underline-offset-2 hover:text-emerald-950"
            >
              Undo
            </button>
          </div>
        )}
      </Card>

      <Modal
        open={!!pendingFile}
        onClose={() => setPendingFile(null)}
        onConfirm={() => pendingFile && void importFrom(pendingFile)}
        title="Replace the current structure?"
        description={`The blocks and manual fields below will be replaced with the structure read from ${pendingFile?.name ?? 'the document'}. It stays a draft until you press Save, and you can undo it.`}
        confirmLabel="Read the document"
        confirmVariant="primary"
      />

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
