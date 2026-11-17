'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, RotateCcw, Save, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { nextPromptVersion, type PromptVersionBump } from '@/lib/prompt-versioning'
import { API_PATH } from '@/lib/commercial-presentations'
import type { PresentationMasterContentRow, PresentationMasterKind, PresentationMasterVersion } from '@/types'
import { PrimaryButton, SecondaryButton } from '../ui'

// Shared plumbing for every master-content editor (structure, agency profile,
// media script, Why Now prompt): load/save through one API, major/minor
// version labels, and a version history with restore + delete. Each editor
// only supplies its own form.
//
// Restore makes an earlier version live again as it is, under its own label:
// no new version is created (the content that was live moves into the
// history). If the editor has unsaved changes, the admin is asked first
// whether to save them as a version, discard them, or cancel — they are only
// saved when the admin says so.

export function useMasterContent<T>(opts: {
  kind: PresentationMasterKind
  refId?: string | null
  language?: string
  initialRow: PresentationMasterContentRow | null
  initialValue: T
  parse: (content: unknown) => T
}) {
  const [row, setRow] = useState(opts.initialRow)
  const [value, setValue] = useState<T>(opts.initialValue)
  const [saved, setSaved] = useState<T>(opts.initialValue)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyKey, setHistoryKey] = useState(0)

  const dirty = JSON.stringify(value) !== JSON.stringify(saved)

  const applyRow = useCallback(
    (next: PresentationMasterContentRow) => {
      const parsed = opts.parse(next.content)
      setRow(next)
      setValue(parsed)
      setSaved(parsed)
      setHistoryKey((k) => k + 1)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  async function save(bump: PromptVersionBump) {
    setSaving(true)
    setError(null)
    const res = await fetch(`${API_PATH}/master`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: opts.kind, refId: opts.refId ?? null, language: opts.language, content: value, bump }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setError(data.error || 'Failed to save')
      return false
    }
    applyRow(data.row)
    return true
  }

  return { row, value, setValue, dirty, save, saving, error, setError, applyRow, historyKey }
}

export type MasterContentState = ReturnType<typeof useMasterContent<unknown>>

export function MasterSaveBar({
  liveVersion,
  versionLabels,
  dirty,
  saving,
  error,
  onSave,
  isNew,
}: {
  liveVersion: string | null
  versionLabels: string[]
  dirty: boolean
  saving: boolean
  error: string | null
  onSave: (bump: PromptVersionBump) => void
  isNew: boolean
}) {
  const [bump, setBump] = useState<PromptVersionBump>('minor')
  const labels = [liveVersion, ...versionLabels]
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e5e3df] bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        {liveVersion ? (
          <span className="rounded bg-black px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Live v{liveVersion}</span>
        ) : (
          <span className="text-gray-500">Not saved yet</span>
        )}
        {dirty && <span className="text-amber-700">Unsaved changes</span>}
        {error && <span className="text-red-600">{error}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!isNew && (
          <div role="radiogroup" aria-label="Version type" className="inline-flex rounded-xl border border-[#e5e3df] p-0.5">
            {(['minor', 'major'] as const).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={bump === b}
                onClick={() => setBump(b)}
                className={`rounded-lg px-3 py-1.5 text-xs ${bump === b ? 'bg-black text-white' : 'text-gray-600 hover:text-black'}`}
              >
                {b === 'minor' ? 'Minor update' : 'New major version'} <span className="opacity-60">v{nextPromptVersion(labels, b)}</span>
              </button>
            ))}
          </div>
        )}
        <PrimaryButton icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={() => onSave(bump)}>
          Save
        </PrimaryButton>
      </div>
    </div>
  )
}

// Asked before restoring a version over unsaved edits.
function UnsavedChangesDialog({
  label,
  busy,
  onSaveFirst,
  onDiscard,
  onCancel,
}: {
  label: string
  busy: boolean
  onSaveFirst: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div className="relative mx-4 w-full max-w-md rounded-sm bg-white p-6 shadow-xl">
        <h3 id="unsaved-title" className="mb-2 text-sm font-semibold text-gray-900">
          You have unsaved changes
        </h3>
        <p className="mb-6 text-sm text-gray-500">
          Restoring v{label} makes it live and replaces what&apos;s in the editor. Do you want to save your current changes as a version first?
        </p>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <PrimaryButton loading={busy} onClick={onSaveFirst}>
            Save my changes, then restore
          </PrimaryButton>
          <SecondaryButton disabled={busy} onClick={onDiscard}>
            Discard them and restore
          </SecondaryButton>
          <SecondaryButton disabled={busy} onClick={onCancel}>
            Cancel
          </SecondaryButton>
        </div>
      </div>
    </div>
  )
}

export function MasterVersionHistory({
  master,
  summarize,
  onLabels,
}: {
  master: Pick<MasterContentState, 'row' | 'historyKey' | 'dirty' | 'save' | 'applyRow'>
  summarize: (content: unknown) => string
  onLabels: (labels: string[]) => void
}) {
  const contentId = master.row?.id ?? null
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<PresentationMasterVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<PresentationMasterVersion | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<PresentationMasterVersion | null>(null)
  const [busyRestore, setBusyRestore] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!contentId) return
    setLoading(true)
    const res = await fetch(`${API_PATH}/master/${contentId}/versions`)
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    const list = (data.versions || []) as PresentationMasterVersion[]
    setVersions(list)
    onLabels(list.map((v) => v.version_label))
  }, [contentId, onLabels])

  useEffect(() => {
    load()
  }, [load, master.historyKey])

  // Makes the version live as it is (server swaps it with the live content).
  async function restoreNow(v: PresentationMasterVersion) {
    setBusyRestore(v.id)
    setError(null)
    const res = await fetch(`${API_PATH}/master/versions/${v.id}`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusyRestore(null)
    if (!res.ok) {
      setError(data.error || 'Failed to restore')
      return
    }
    master.applyRow(data.row)
  }

  function restore(v: PresentationMasterVersion) {
    if (master.dirty) setPendingRestore(v)
    else restoreNow(v)
  }

  async function removeVersion() {
    if (!deleting) return
    setBusyDelete(true)
    setError(null)
    const res = await fetch(`${API_PATH}/master/versions/${deleting.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    setBusyDelete(false)
    if (!res.ok) setError(data.error || 'Something went wrong')
    else await load()
    setDeleting(null)
  }

  if (!contentId) return null
  return (
    <div className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
      <Modal
        open={Boolean(deleting)}
        onClose={() => !busyDelete && setDeleting(null)}
        onConfirm={removeVersion}
        title={`Delete v${deleting?.version_label ?? ''}?`}
        description="This saved version is removed from the history permanently. The live content and approved presentations are not affected."
        confirmLabel="Delete version"
        loading={busyDelete}
      />
      {pendingRestore && (
        <UnsavedChangesDialog
          label={pendingRestore.version_label}
          busy={busyRestore === pendingRestore.id}
          onCancel={() => setPendingRestore(null)}
          onDiscard={async () => {
            await restoreNow(pendingRestore)
            setPendingRestore(null)
          }}
          onSaveFirst={async () => {
            setBusyRestore(pendingRestore.id)
            const ok = await master.save('minor')
            if (ok) await restoreNow(pendingRestore)
            else setBusyRestore(null)
            setPendingRestore(null)
          }}
        />
      )}
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-4 text-xs font-medium uppercase tracking-wider text-gray-600 hover:text-black">
        <span className="flex items-center gap-2">
          <History size={14} /> Version history {versions.length > 0 && <span className="normal-case text-gray-400">({versions.length} saved)</span>}
        </span>
        <span>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="border-t border-[#e5e3df] px-5 py-4">
          <p className="mb-3 text-xs text-gray-500">Restore makes a version live again as it is. No new version is created; the current live version moves here.</p>
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
          {!loading && versions.length === 0 && <p className="text-xs text-gray-400">No earlier versions yet.</p>}
          <ul className="flex flex-col gap-2">
            {versions.map((v) => (
              <li key={v.id} className="flex items-start justify-between gap-3 rounded-xl border border-[#e5e3df] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800">v{v.version_label}</p>
                  <p className="line-clamp-2 text-xs text-gray-600">{summarize(v.content)}</p>
                  <p className="mt-1 text-[10px] text-gray-400">
                    {new Date(v.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    {v.saved_by_name ? ` · ${v.saved_by_name}` : ''}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <SecondaryButton icon={<RotateCcw size={12} />} loading={busyRestore === v.id} disabled={Boolean(busyRestore)} onClick={() => restore(v)}>
                    Restore
                  </SecondaryButton>
                  <button
                    type="button"
                    onClick={() => setDeleting(v)}
                    className="p-1.5 text-gray-300 transition-colors hover:text-red-500"
                    title="Delete version"
                    aria-label={`Delete version ${v.version_label}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
