'use client'

import { useEffect, useState } from 'react'
import { Loader2, History, PlayCircle, Save, Trash2 } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { nextPromptVersion, type PromptVersionBump } from '@/lib/copywriting'

interface VersionRow {
  id: string
  prompt_text: string
  prompt_version: string
  saved_by_email: string | null
  created_at: string
}

interface Props {
  promptKey: string
  label: string
  initialText: string
  initialVersion: string
}

export default function AdminPromptEditor({ promptKey, label, initialText, initialVersion }: Props) {
  const [text, setText] = useState(initialText)
  const [liveVersion, setLiveVersion] = useState(initialVersion)
  const [bump, setBump] = useState<PromptVersionBump>('minor')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [sampleText, setSampleText] = useState('')
  const [testOutput, setTestOutput] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadVersions() {
    setLoadingVersions(true)
    const res = await fetch(`/api/copywriting/admin/prompts/${promptKey}/versions`)
    const data = await res.json().catch(() => ({}))
    setLoadingVersions(false)
    setVersions(data.versions || [])
  }

  useEffect(() => {
    if (versionsOpen) loadVersions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionsOpen])

  async function save() {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/copywriting/admin/prompts/${promptKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptText: text, bump }),
    })
    setSaving(false)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Failed to save')
      return
    }
    if (data.promptVersion) setLiveVersion(data.promptVersion)
    setBump('minor')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    if (versionsOpen) loadVersions()
  }

  async function restore(versionId: string) {
    setRestoringId(versionId)
    const res = await fetch(`/api/copywriting/admin/prompts/${promptKey}/versions/${versionId}`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setRestoringId(null)
    if (res.ok) {
      setText(data.promptText)
      if (data.promptVersion) setLiveVersion(data.promptVersion)
      loadVersions()
    } else {
      setError(data.error || 'Failed to restore version')
    }
  }

  async function remove(versionId: string) {
    setDeletingId(versionId)
    setError(null)
    const res = await fetch(`/api/copywriting/admin/prompts/${promptKey}/versions/${versionId}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    setDeletingId(null)
    setConfirmDeleteId(null)
    if (!res.ok) {
      setError(data.error || 'Failed to delete version')
      return
    }
    setVersions((prev) => prev.filter((v) => v.id !== versionId))
  }

  async function runTest() {
    setTesting(true)
    setTestOutput(null)
    setError(null)
    const res = await fetch(`/api/copywriting/admin/prompts/${promptKey}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptText: text, sampleText }),
    })
    const data = await res.json().catch(() => ({}))
    setTesting(false)
    if (!res.ok) {
      setError(data.error || 'Test run failed')
      return
    }
    setTestOutput(data.output)
  }

  const pendingDelete = versions.find((v) => v.id === confirmDeleteId)

  return (
    <div className="flex flex-col gap-8">
      <Modal
        open={!!pendingDelete}
        onClose={() => { if (!deletingId) setConfirmDeleteId(null) }}
        onConfirm={() => pendingDelete && remove(pendingDelete.id)}
        title={`Delete v${pendingDelete?.prompt_version ?? ''}?`}
        description="This saved version will be permanently removed from the history and can't be restored afterwards. The live prompt is not affected."
        confirmLabel="Delete version"
        confirmVariant="danger"
        loading={!!deletingId}
      />

      <div className="bg-white border border-[#e5e3df] p-6 sm:p-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-gray-900">{label}</h2>
            <span className="text-[10px] font-semibold uppercase tracking-wider bg-black text-white px-1.5 py-0.5">
              Live v{liveVersion}
            </span>
          </div>
          <button onClick={() => setVersionsOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black transition-colors">
            <History size={13} /> Version history
          </button>
        </div>
        <Textarea label="Prompt text" rows={14} value={text} onChange={(e) => setText(e.target.value)} className="mt-4 font-mono text-xs" />
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-3 flex-wrap">
          <div role="radiogroup" aria-label="Version type" className="inline-flex border border-[#e5e3df]">
            {(['minor', 'major'] as const).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={bump === b}
                onClick={() => setBump(b)}
                className={`px-3 py-2 text-xs transition-colors ${bump === b ? 'bg-black text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {b === 'minor' ? 'Minor update' : 'New major version'}
                <span className={`ml-1.5 ${bump === b ? 'text-gray-300' : 'text-gray-400'}`}>
                  v{nextPromptVersion([liveVersion, ...versions.map((v) => v.prompt_version)], b)}
                </span>
              </button>
            ))}
          </div>
          <Button size="sm" onClick={save} loading={saving}>
            <Save size={13} className="mr-1.5 inline" /> {saved ? `Saved as v${liveVersion}` : 'Save'}
          </Button>
        </div>

        {versionsOpen && (
          <div className="mt-6 border-t border-[#e5e3df] pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Previous versions</p>
            <p className="text-[10px] text-gray-400 mt-1 mb-3">Restoring a version puts its text live as a new minor version.</p>
            {loadingVersions && <Loader2 size={14} className="animate-spin text-gray-400" />}
            {!loadingVersions && versions.length === 0 && <p className="text-xs text-gray-400">No earlier versions yet.</p>}
            <div className="flex flex-col gap-2">
              {versions.map((v) => (
                <div key={v.id} className="flex items-start justify-between gap-3 border border-[#e5e3df] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 mb-1">v{v.prompt_version}</p>
                    <p className="text-xs text-gray-600 line-clamp-2">{v.prompt_text}</p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {new Date(v.created_at).toLocaleString()}{v.saved_by_email ? ` · ${v.saved_by_email}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button size="sm" variant="ghost" loading={restoringId === v.id} onClick={() => restore(v.id)}>
                      Restore
                    </Button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(v.id)}
                      className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                      title="Delete version"
                      aria-label={`Delete version ${v.prompt_version}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#e5e3df] p-6 sm:p-8">
        <h2 className="text-sm font-semibold text-gray-900">Test against a sample</h2>
        <p className="text-xs text-gray-500 mt-1">
          Paste sample source material and run the prompt above (including any unsaved edits) to see the effect before it goes live.
        </p>
        <Textarea label="Sample content" rows={6} value={sampleText} onChange={(e) => setSampleText(e.target.value)} className="mt-4" placeholder="Paste a sample article or source text here…" />
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="secondary" onClick={runTest} loading={testing}>
            <PlayCircle size={13} className="mr-1.5 inline" /> Run test
          </Button>
        </div>
        {testOutput !== null && (
          <div className="mt-4 border-t border-[#e5e3df] pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-2">Output</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{testOutput}</p>
          </div>
        )}
      </div>
    </div>
  )
}
