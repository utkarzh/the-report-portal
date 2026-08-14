'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileSpreadsheet, Loader2, Trash2, X } from 'lucide-react'

interface Tracker {
  id: string
  country: string
  filename: string | null
  row_count: number
  updated_at: string
}

export default function AdvertiserTrackerManager({ initial }: { initial: Tracker[] }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [country, setCountry] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function upload() {
    if (!country.trim() || !file || busy) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const fd = new FormData()
      fd.append('country', country.trim())
      fd.append('file', file)
      const res = await fetch('/api/meeting-prep/advertiser-tracker', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setNotice(`${data.replaced ? 'Updated' : 'Added'} ${data.country} — ${data.rows} rows parsed.`)
      setCountry(''); setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: string) {
    setDeleting(c); setError(null)
    try {
      const res = await fetch(`/api/meeting-prep/advertiser-tracker/${encodeURIComponent(c)}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Delete failed') }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Upload */}
      <div className="bg-white border border-[#e5e3df] p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-gray-900">Upload a country tracker</h2>
        <p className="text-xs text-gray-500 mt-1">
          Uploading a country that already exists replaces its tracker (this is the weekly update). Only the
          parsed rows are stored — the file itself isn&apos;t kept.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Country</label>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g. Georgia"
              className="w-full rounded-lg border border-[#e5e3df] bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Spreadsheet (.xlsx)</label>
            {file ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-[#e5e3df] bg-[#fcfbf8] px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm text-gray-800">
                  <FileSpreadsheet size={15} className="flex-shrink-0 text-gray-500" />
                  <span className="truncate">{file.name}</span>
                </span>
                <button onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = '' }} className="text-gray-400 hover:text-gray-700" aria-label="Remove">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => inputRef.current?.click()}
                className="flex w-full items-center gap-2 rounded-lg border border-dashed border-[#d4d0c8] bg-[#fcfbf8] px-3 py-2 text-sm text-gray-600 hover:border-gray-400"
              >
                <Upload size={15} /> Choose file
              </button>
            )}
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <button
            onClick={upload}
            disabled={!country.trim() || !file || busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            <span>Upload</span>
          </button>
        </div>

        {notice && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
        {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {/* List */}
      <div className="bg-white border border-[#e5e3df]">
        {initial.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No country trackers yet. Upload one above.</p>
        ) : (
          <ul className="divide-y divide-[#e5e3df]">
            {initial.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{t.country}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {t.row_count} rows · {t.filename || 'spreadsheet'} · updated {new Date(t.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <button
                  onClick={() => remove(t.country)}
                  disabled={deleting === t.country}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting === t.country ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  <span>Remove</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
