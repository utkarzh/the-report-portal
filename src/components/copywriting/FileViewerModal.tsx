'use client'

import { useEffect, useState } from 'react'
import { X, ExternalLink, Loader2, FileText } from 'lucide-react'

interface FileView {
  filename: string
  mime: string | null
  text: string
  charCount: number
  truncated: boolean
  url: string | null
}

// "View" for any uploaded Copywriting file (sources, publication guides, TRC
// guides). Fetches `endpoint` (which returns FileViewPayload) when opened.
// PDFs show the original inline with a toggle to the extracted text; every
// other type (.docx/.xlsx/.txt/.md) shows the extracted text — what the AI
// actually reads — since browsers can't render Word/Excel inline. "Open
// original" opens (or downloads) the real file from a short-lived link.
export default function FileViewerModal({ endpoint, onClose }: { endpoint: string | null; onClose: () => void }) {
  const [file, setFile] = useState<FileView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'original' | 'text'>('text')

  useEffect(() => {
    if (!endpoint) return
    let cancelled = false
    setFile(null)
    setError(null)
    fetch(endpoint)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) return setError(data.error || 'Could not open this file')
        setFile(data)
        setMode(isPdf(data) && data.url ? 'original' : 'text')
      })
      .catch(() => !cancelled && setError('Could not open this file'))
    return () => {
      cancelled = true
    }
  }, [endpoint])

  useEffect(() => {
    if (!endpoint) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [endpoint, onClose])

  if (!endpoint) return null
  const pdf = file ? isPdf(file) : false

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-sm bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#e5e3df] px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={15} className="flex-shrink-0 text-gray-400" />
            <p className="truncate text-sm font-semibold text-gray-900">{file?.filename || 'Loading…'}</p>
            {file && <span className="flex-shrink-0 text-[11px] text-gray-400">{file.charCount.toLocaleString()} characters</span>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {pdf && file?.url && (
              <div className="flex overflow-hidden rounded-md border border-[#e5e3df] text-xs">
                <button onClick={() => setMode('original')} className={`px-2.5 py-1 ${mode === 'original' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Original</button>
                <button onClick={() => setMode('text')} className={`px-2.5 py-1 ${mode === 'text' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Text</button>
              </div>
            )}
            {file?.url && (
              <a href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-[#e5e3df] px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400">
                <ExternalLink size={12} /> Open original
              </a>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#faf9f7]">
          {error ? (
            <p className="p-6 text-sm text-red-600">{error}</p>
          ) : !file ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 size={18} className="animate-spin text-gray-400" />
            </div>
          ) : mode === 'original' && pdf && file.url ? (
            <iframe src={file.url} title={file.filename} className="h-full w-full border-0 bg-white" />
          ) : (
            <div className="p-6">
              {!pdf && (
                <p className="mb-3 text-[11px] text-gray-500">
                  Showing the text extracted from this file — exactly what the AI reads. Use “Open original” to see the file itself.
                </p>
              )}
              {file.truncated && (
                <p className="mb-3 text-[11px] text-amber-700">This file was shortened when it was uploaded — the AI only reads the text shown here.</p>
              )}
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-gray-800">{file.text || '(No text could be extracted from this file.)'}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function isPdf(f: { filename: string; mime: string | null }) {
  return f.mime === 'application/pdf' || /\.pdf$/i.test(f.filename)
}
