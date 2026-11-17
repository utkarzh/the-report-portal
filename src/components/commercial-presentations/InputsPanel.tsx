'use client'

import { useMemo, useState } from 'react'
import type { WorkspaceApi } from './PresentationWorkspace'
import { Card, CardHeader, FieldLabel, PrimaryButton, inputClass } from './ui'

// Step 2 — inputs (brief §11, §16, §17). The optional Why Now inputs and the
// manual fields the commercial team supplies. The manual fields come from the
// admin-configured structure, so adding a field there adds it here.

export default function InputsPanel({ api }: { api: WorkspaceApi }) {
  const { state, mutate } = api
  const { project, presentation, manualFields, permissions } = state
  const canEdit = permissions.canEdit

  const initial = useMemo(
    () => ({
      anchorEvent: project.anchor_event,
      relevantDate: presentation.why_now_inputs.relevantDate || project.anchor_date || '',
      additionalContext: presentation.why_now_inputs.additionalContext || '',
      manual: { ...presentation.manual_inputs } as Record<string, string>,
    }),
    [project, presentation],
  )
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [syncedFrom, setSyncedFrom] = useState(initial)
  // Re-sync when the server state changes underneath (e.g. after approval).
  if (syncedFrom !== initial) {
    setSyncedFrom(initial)
    setForm(initial)
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  async function save() {
    setSaving(true)
    await mutate('', 'PATCH', {
      project: { anchorEvent: form.anchorEvent, anchorDate: form.relevantDate },
      whyNowInputs: { relevantDate: form.relevantDate, additionalContext: form.additionalContext },
      manualInputs: form.manual,
    })
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader
        step="Step 2"
        title="Inputs"
        description="Everything here is optional except the fields marked *. With no anchor event, the AI finds the strongest Why Now itself and Block 2 uses the “without anchor event” wording."
        action={
          canEdit && (
            <PrimaryButton loading={saving} disabled={!dirty} onClick={save}>
              {dirty ? 'Save inputs' : 'Saved'}
            </PrimaryButton>
          )
        }
      />

      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Why [Country] Now — optional</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor="anchor-event">Anchor event / editorial momentum</FieldLabel>
          <input
            id="anchor-event"
            className={inputClass}
            disabled={!canEdit}
            placeholder="e.g. G20 Summit in Miami"
            value={form.anchorEvent}
            onChange={(e) => setForm({ ...form, anchorEvent: e.target.value })}
          />
        </div>
        <div>
          <FieldLabel htmlFor="relevant-date">Relevant date</FieldLabel>
          <input
            id="relevant-date"
            className={inputClass}
            disabled={!canEdit}
            placeholder="e.g. November 2026"
            value={form.relevantDate}
            onChange={(e) => setForm({ ...form, relevantDate: e.target.value })}
          />
        </div>
        <div className="md:col-span-2">
          <FieldLabel htmlFor="additional-context">Additional context</FieldLabel>
          <textarea
            id="additional-context"
            rows={2}
            className={inputClass}
            disabled={!canEdit}
            placeholder="e.g. The President has been invited to the G20. Emphasise growing US relations and recent investment announcements."
            value={form.additionalContext}
            onChange={(e) => setForm({ ...form, additionalContext: e.target.value })}
          />
        </div>
      </div>

      {manualFields.length > 0 && (
        <>
          <p className="mb-3 mt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Manual inputs — supplied by the team</p>
          <div className="grid gap-4 md:grid-cols-2">
            {manualFields.map((f) => (
              <div key={f.key} className={f.multiline ? 'md:col-span-2' : ''}>
                <FieldLabel htmlFor={`manual-${f.key}`}>
                  {f.label}
                  {f.required ? ' *' : ''}
                </FieldLabel>
                {f.multiline ? (
                  <textarea
                    id={`manual-${f.key}`}
                    rows={3}
                    className={inputClass}
                    disabled={!canEdit}
                    placeholder={f.placeholder}
                    value={form.manual[f.key] || ''}
                    onChange={(e) => setForm({ ...form, manual: { ...form.manual, [f.key]: e.target.value } })}
                  />
                ) : (
                  <input
                    id={`manual-${f.key}`}
                    className={inputClass}
                    disabled={!canEdit}
                    placeholder={f.placeholder}
                    value={form.manual[f.key] || ''}
                    onChange={(e) => setForm({ ...form, manual: { ...form.manual, [f.key]: e.target.value } })}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-500">
            The people to name-drop and the mockup details are the team&apos;s decision; the AI never chooses them. Make sure they match the mockup you&apos;ll show.
          </p>
        </>
      )}
    </Card>
  )
}
