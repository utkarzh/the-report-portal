'use client'

import { useRef } from 'react'
import { Paperclip, FileText, X } from 'lucide-react'
import { SAMPLE_ACCEPT, SAMPLE_EXT_RE, MAX_RESEARCH_DOCS } from '@/lib/research-docs'

// Client-side picker for company documents attached on the new-interview
// screen. Holds File objects only — nothing is uploaded until the form is
// submitted (ResearchForm uploads them once the session id exists).
const MAX_DOC_BYTES = 30 * 1024 * 1024 // 30 MB per document

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

interface Props {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
  error?: string | null
  onError?: (msg: string | null) => void
}

export default function ResearchDocPicker({ files, onChange, disabled, error, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const atLimit = files.length >= MAX_RESEARCH_DOCS

  function addFiles(list: FileList | null) {
    if (!list) return
    onError?.(null)
    const next = [...files]
    for (const f of Array.from(list)) {
      if (next.length >= MAX_RESEARCH_DOCS) {
        onError?.(`You can attach up to ${MAX_RESEARCH_DOCS} documents.`)
        break
      }
      if (!SAMPLE_EXT_RE.test(f.name)) {
        onError?.(`"${f.name}" is not a supported format (.docx, .pdf, .txt, .md).`)
        continue
      }
      if (f.size > MAX_DOC_BYTES) {
        onError?.(`"${f.name}" is too large (max 30 MB).`)
        continue
      }
      if (next.some((e) => e.name === f.name && e.size === f.size)) continue
      next.push(f)
    }
    onChange(next)
    if (inputRef.current) inputRef.current.value = ''
  }

  function removeAt(i: number) {
    onChange(files.filter((_, idx) => idx !== i))
    onError?.(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Company Documents
        </label>
        <span className="text-[10px] text-gray-400">optional · {files.length}/{MAX_RESEARCH_DOCS}</span>
      </div>
      <p className="-mt-1 text-[11px] leading-relaxed text-gray-400">
        Annual reports, sustainability reports, etc. (.docx, .pdf, .txt, .md). Used as context for the research.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={SAMPLE_ACCEPT}
        multiple
        className="sr-only"
        disabled={disabled || atLimit}
        onChange={(e) => addFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || atLimit}
        className="inline-flex items-center gap-2 self-start border border-[#c9c6c0] px-3 py-2 text-xs text-gray-700 transition-colors hover:border-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Paperclip size={13} />
        {atLimit ? `Limit of ${MAX_RESEARCH_DOCS} reached` : 'Attach documents'}
      </button>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {files.length > 0 && (
        <ul className="mt-1 flex flex-col divide-y divide-[#e5e3df] border border-[#e5e3df]">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 px-3 py-2">
              <FileText size={14} className="flex-shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{f.name}</span>
              <span className="flex-shrink-0 text-[10px] text-gray-400">{fmtBytes(f.size)}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={`Remove ${f.name}`}
                  className="flex-shrink-0 text-gray-300 transition-colors hover:text-red-500"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
