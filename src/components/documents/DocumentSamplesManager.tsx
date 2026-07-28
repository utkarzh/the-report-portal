'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, Trash2, Loader2, Check } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  DOCUMENT_SAMPLES_BUCKET,
  MAX_SAMPLES,
  SAMPLE_ACCEPT,
  SAMPLE_EXT_RE,
} from '@/lib/documents'
import type { DocType } from '@/types'

// A sample's list-shape (no extracted_text — that's only used server-side).
interface SampleRow {
  id: string
  filename: string
  size_bytes: number | null
  char_count: number
  truncated: boolean
  created_at: string
}

interface Props {
  docType: DocType
  label: string
  userId: string
  initialSamples: SampleRow[]
}

const MAX_SAMPLE_BYTES = 20 * 1024 * 1024 // 20 MB per sample document

function fmtBytes(n: number | null): string {
  if (!n) return ''
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export default function DocumentSamplesManager({ docType, label, userId, initialSamples }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [samples, setSamples] = useState<SampleRow[]>(initialSamples)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const atLimit = samples.length >= MAX_SAMPLES

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setError(null)
    const files = Array.from(list)
    const supabase = getSupabaseBrowserClient()

    setBusy(true)
    try {
      for (const file of files) {
        if (samples.length >= MAX_SAMPLES) {
          setError(`You can attach at most ${MAX_SAMPLES} sample documents.`)
          break
        }
        if (!SAMPLE_EXT_RE.test(file.name)) {
          setError(`"${file.name}" is not a supported format (.docx, .pdf, .xlsx, .xls, .txt, .md).`)
          continue
        }
        if (file.size > MAX_SAMPLE_BYTES) {
          setError(`"${file.name}" is too large (max 20 MB).`)
          continue
        }

        const ext = file.name.split('.').pop() || 'bin'
        const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`

        const { error: upErr } = await supabase
          .storage
          .from(DOCUMENT_SAMPLES_BUCKET)
          .upload(storagePath, file, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
          })
        if (upErr) {
          setError(`Upload failed for "${file.name}". Please try again.`)
          continue
        }

        const res = await fetch('/api/document-samples', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docType,
            storagePath,
            filename: file.name,
            mime: file.type || null,
            sizeBytes: file.size,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || `Failed to add "${file.name}".`)
          continue
        }
        setSamples((prev) => [data.sample as SampleRow, ...prev])
      }
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    setError(null)
    const res = await fetch(`/api/document-samples/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to delete sample.')
    } else {
      setSamples((prev) => prev.filter((s) => s.id !== id))
    }
    setDeletingId(null)
    setConfirmId(null)
  }

  return (
    <div className="bg-white border border-[#e5e3df]">
      <div className="px-5 sm:px-6 py-4 border-b border-[#e5e3df]">
        <h3 className="text-sm font-semibold text-gray-900">Sample {label}s</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Upload up to {MAX_SAMPLES} example documents (.docx, .pdf, .xlsx, .xls, .txt, .md). Claude uses these to shape the structure, depth, and tone of every generated {label.toLowerCase()}.
        </p>
      </div>

      {error && (
        <div className="px-5 sm:px-6 py-3 text-sm text-red-700 bg-red-50 border-b border-[#e5e3df]">
          {error}
        </div>
      )}

      <div className="p-5 sm:p-6 flex flex-col gap-4">
        {/* Upload control */}
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={SAMPLE_ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
            disabled={busy || atLimit}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || atLimit}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#c9c6c0] text-sm text-gray-700 hover:border-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {busy ? 'Uploading…' : atLimit ? `Limit of ${MAX_SAMPLES} reached` : 'Upload sample documents'}
          </button>
          <span className="ml-3 text-xs text-gray-400">{samples.length} / {MAX_SAMPLES}</span>
        </div>

        {/* Sample list */}
        {samples.length === 0 ? (
          <p className="text-sm text-gray-400">No sample documents yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[#e5e3df] border border-[#e5e3df]">
            {samples.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <FileText size={16} className="text-gray-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-800 truncate">{s.filename}</p>
                  <p className="text-xs text-gray-400">
                    {fmtBytes(s.size_bytes)}
                    {s.char_count ? ` · ${s.char_count.toLocaleString()} chars extracted` : ''}
                    {s.truncated ? ' · truncated' : ''}
                  </p>
                </div>
                {confirmId === s.id ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider bg-red-600 text-white px-2 py-1 hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {deletingId === s.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="text-[10px] font-semibold uppercase tracking-wider bg-gray-200 text-gray-600 px-2 py-1 hover:bg-gray-300 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(s.id)}
                    className="p-1.5 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                    title="Delete sample"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
