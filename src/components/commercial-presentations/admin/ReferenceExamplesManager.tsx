'use client'

import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { API_PATH, REFERENCE_PROJECT_TYPES, wordCount } from '@/lib/commercial-presentations'
import type { PresentationReferenceExample } from '@/types'
import { Card, CardHeader, FieldLabel, Notice, PrimaryButton, SecondaryButton, inputClass } from '../ui'

// Approved Reference Examples (brief §13): 10–20 strong past presentations or
// interview letters, chosen by Admin/Editorial and classified by project type.
// The AI uses them ONLY for tone, rhythm, length and reasoning — the system
// prompt forbids transferring any fact from them.

type Draft = { id?: string; title: string; projectType: string; body: string; active: boolean }
const EMPTY: Draft = { title: '', projectType: REFERENCE_PROJECT_TYPES[0], body: '', active: true }

export default function ReferenceExamplesManager({ initial }: { initial: PresentationReferenceExample[] }) {
  const [examples, setExamples] = useState(initial)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<PresentationReferenceExample | null>(null)
  const active = examples.filter((e) => e.active).length

  async function save() {
    if (!draft) return
    setSaving(true)
    setError(null)
    const res = await fetch(draft.id ? `${API_PATH}/examples/${draft.id}` : `${API_PATH}/examples`, {
      method: draft.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setError(data.error || 'Failed to save')
    setExamples(draft.id ? examples.map((e) => (e.id === draft.id ? data.example : e)) : [data.example, ...examples])
    setDraft(null)
  }

  async function toggle(e: PresentationReferenceExample) {
    const res = await fetch(`${API_PATH}/examples/${e.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !e.active }) })
    const data = await res.json().catch(() => ({}))
    if (res.ok) setExamples(examples.map((x) => (x.id === e.id ? data.example : x)))
  }

  return (
    <div className="flex flex-col gap-6">
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          const res = await fetch(`${API_PATH}/examples/${deleting.id}`, { method: 'DELETE' })
          if (res.ok) setExamples(examples.filter((x) => x.id !== deleting.id))
          setDeleting(null)
        }}
        title={`Delete “${deleting?.title ?? ''}”?`}
        description="The example is removed permanently. Existing presentations are not affected."
        confirmLabel="Delete example"
      />
      {active > 20 && <Notice tone="warn">{active} examples are active. The brief recommends a selective set of 10–20 strong examples.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {draft ? (
        <Card>
          <CardHeader title={draft.id ? 'Edit example' : 'New example'} />
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <FieldLabel htmlFor="ex-title">Title</FieldLabel>
              <input id="ex-title" className={inputClass} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Kazakhstan × USA Today (G20)" />
            </div>
            <div>
              <FieldLabel htmlFor="ex-type">Project type</FieldLabel>
              <select id="ex-type" className={inputClass} value={draft.projectType} onChange={(e) => setDraft({ ...draft, projectType: e.target.value })}>
                {REFERENCE_PROJECT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <FieldLabel htmlFor="ex-body">Example text</FieldLabel>
              <textarea id="ex-body" rows={10} className={inputClass} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Paste the Why Now section (or the strong part of a past interview letter)." />
              <p className="mt-1 text-[11px] text-gray-500">{wordCount(draft.body)} words</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <PrimaryButton loading={saving} disabled={!draft.title.trim() || !draft.body.trim()} onClick={save}>
              Save example
            </PrimaryButton>
            <SecondaryButton onClick={() => setDraft(null)}>Cancel</SecondaryButton>
          </div>
        </Card>
      ) : (
        <div>
          <PrimaryButton icon={<Plus size={14} />} onClick={() => setDraft(EMPTY)}>
            Add example
          </PrimaryButton>
        </div>
      )}

      <Card>
        <CardHeader title={`Examples (${active} active)`} description="Inactive examples are kept but never sent to the AI." />
        {examples.length === 0 ? (
          <p className="text-sm text-gray-500">No examples yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[#efede9]">
            {examples.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${e.active ? 'text-gray-900' : 'text-gray-400'}`}>{e.title}</p>
                  <p className="text-xs text-gray-500">
                    {e.project_type || 'Unclassified'} · {wordCount(e.body)} words
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" checked={e.active} onChange={() => toggle(e)} /> Active
                  </label>
                  <button type="button" aria-label={`Edit ${e.title}`} onClick={() => setDraft({ id: e.id, title: e.title, projectType: e.project_type, body: e.body, active: e.active })} className="p-1.5 text-gray-400 hover:text-black">
                    <Pencil size={14} />
                  </button>
                  <button type="button" aria-label={`Delete ${e.title}`} onClick={() => setDeleting(e)} className="p-1.5 text-gray-300 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
