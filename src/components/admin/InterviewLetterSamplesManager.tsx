'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, Trash2, Loader2, Check, Pencil } from 'lucide-react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  INTERVIEW_LETTER_COMPANIES,
  INTERVIEW_LETTER_SAMPLES_BUCKET,
  INTERVIEW_LETTER_VARIANTS,
  SAMPLE_LETTER_ACCEPT,
  SAMPLE_LETTER_EXT_RE,
  variantLabel,
} from '@/lib/interview-letters'
import type { InterviewLetterSample } from '@/types'

interface Props {
  userId: string
  initialSamples: InterviewLetterSample[]
}

interface Tags {
  company: string
  variant: string
  sector: string
  notes: string
}

const MAX_SAMPLE_BYTES = 20 * 1024 * 1024

const COMPANY_OPTIONS = [{ value: 'any', label: 'Both companies' }, ...INTERVIEW_LETTER_COMPANIES.map((c) => ({ value: c.value, label: c.value }))]
const VARIANT_OPTIONS = [{ value: 'any', label: 'Either version' }, ...INTERVIEW_LETTER_VARIANTS.map((v) => ({ value: v.value, label: v.label }))]

function TagFields({ tags, onChange }: { tags: Tags; onChange: (t: Tags) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Select label="Company" options={COMPANY_OPTIONS} value={tags.company} onChange={(e) => onChange({ ...tags, company: e.target.value })} placeholder="" />
        <Select label="Letter version" options={VARIANT_OPTIONS} value={tags.variant} onChange={(e) => onChange({ ...tags, variant: e.target.value })} placeholder="" />
        <Input label="Sector / report type" placeholder="e.g. Tourism, Security" value={tags.sector} onChange={(e) => onChange({ ...tags, sector: e.target.value })} />
      </div>
      <Textarea
        label="Notes for the AI (optional)"
        placeholder="e.g. Ministerial letter for a security report timed with the Munich Security Conference"
        value={tags.notes}
        onChange={(e) => onChange({ ...tags, notes: e.target.value })}
        rows={2}
      />
    </div>
  )
}

function fmtBytes(n: number | null): string {
  if (!n) return ''
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export default function InterviewLetterSamplesManager({ userId, initialSamples }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [samples, setSamples] = useState(initialSamples)
  const [tags, setTags] = useState<Tags>({ company: 'any', variant: 'any', sector: '', notes: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Tags & { title: string }>({ title: '', company: 'any', variant: 'any', sector: '', notes: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setError(null)
    const supabase = getSupabaseBrowserClient()
    try {
      for (const file of Array.from(list)) {
        if (!SAMPLE_LETTER_EXT_RE.test(file.name)) {
          setError(`"${file.name}" is not a supported format (.docx, .pdf, .txt, .md).`)
          continue
        }
        if (file.size > MAX_SAMPLE_BYTES) {
          setError(`"${file.name}" is too large (max 20 MB).`)
          continue
        }
        setBusy(file.name)
        const ext = file.name.split('.').pop() || 'bin'
        const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from(INTERVIEW_LETTER_SAMPLES_BUCKET)
          .upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false })
        if (upErr) {
          setError(`Upload failed for "${file.name}". Please try again.`)
          continue
        }
        const res = await fetch('/api/interview-letters/samples', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...tags, storagePath, filename: file.name, mime: file.type || null, sizeBytes: file.size }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error || `Failed to add "${file.name}".`)
          continue
        }
        setSamples((prev) => [data.sample as InterviewLetterSample, ...prev])
      }
    } finally {
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function startEdit(s: InterviewLetterSample) {
    setEditingId(s.id)
    setEditDraft({ title: s.title, company: s.company, variant: s.variant, sector: s.sector, notes: s.notes })
  }

  async function saveEdit(id: string) {
    setSavingEdit(true)
    setError(null)
    const res = await fetch(`/api/interview-letters/samples/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editDraft),
    })
    const data = await res.json().catch(() => ({}))
    setSavingEdit(false)
    if (!res.ok) {
      setError(data.error || 'Failed to save.')
      return
    }
    setSamples((prev) => prev.map((s) => (s.id === id ? (data.sample as InterviewLetterSample) : s)))
    setEditingId(null)
  }

  async function remove(id: string) {
    setDeletingId(id)
    setError(null)
    const res = await fetch(`/api/interview-letters/samples/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to delete.')
    } else {
      setSamples((prev) => prev.filter((s) => s.id !== id))
    }
    setDeletingId(null)
    setConfirmId(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="border border-[#e5e3df] bg-white p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-gray-900">Upload sample letters</h2>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-500">
          Set the tags first: they apply to every file in this upload, and you can change them per letter afterwards.
          Tag the sector (e.g. Tourism, Security) so the AI picks the right samples for new kinds of reports.
        </p>
        <div className="mt-5">
          <TagFields tags={tags} onChange={setTags} />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={SAMPLE_LETTER_ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={Boolean(busy)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-2 border border-[#c9c6c0] px-4 py-2.5 text-sm text-gray-700 transition-colors hover:border-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {busy ? `Uploading ${busy}…` : 'Choose files (.docx, .pdf, .txt, .md)'}
          </button>
        </div>
      </section>

      {error && <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="border border-[#e5e3df] bg-white">
        <div className="border-b border-[#e5e3df] px-5 py-4 sm:px-6">
          <h2 className="text-sm font-semibold text-gray-900">Sample letters ({samples.length})</h2>
        </div>
        {samples.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-400 sm:px-6">No sample letters yet.</p>
        ) : (
          <ul className="divide-y divide-[#e5e3df]">
            {samples.map((s) => (
              <li key={s.id} className="px-5 py-4 sm:px-6">
                {editingId === s.id ? (
                  <div className="flex flex-col gap-4">
                    <Input label="Title" value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} />
                    <TagFields tags={editDraft} onChange={(t) => setEditDraft({ ...editDraft, ...t })} />
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" loading={savingEdit} onClick={() => saveEdit(s.id)}>Save</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <FileText size={16} className="mt-0.5 flex-shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{s.title}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className="bg-[#f0efec] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">{s.company === 'any' ? 'Both companies' : s.company}</span>
                        <span className="bg-[#f0efec] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">{variantLabel(s.variant)}</span>
                        {s.sector && <span className="bg-[#fbf7ed] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#a07530]">{s.sector}</span>}
                      </div>
                      {s.notes && <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{s.notes}</p>}
                      <p className="mt-1 text-xs text-gray-400">
                        {s.filename}
                        {s.size_bytes ? ` · ${fmtBytes(s.size_bytes)}` : ''}
                        {s.char_count ? ` · ${s.char_count.toLocaleString()} chars extracted` : ''}
                        {s.truncated ? ' · truncated' : ''}
                      </p>
                    </div>
                    {confirmId === s.id ? (
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => remove(s.id)}
                          disabled={deletingId === s.id}
                          className="inline-flex items-center gap-1 bg-red-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                        >
                          {deletingId === s.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="bg-gray-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600 transition-colors hover:bg-gray-300"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button type="button" onClick={() => startEdit(s)} className="p-1.5 text-gray-400 transition-colors hover:text-black" title="Edit tags">
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={() => setConfirmId(s.id)} className="p-1.5 text-gray-300 transition-colors hover:text-red-500" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
