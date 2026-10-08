'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Upload, X, AlertTriangle } from 'lucide-react'
import { getSupabaseBrowserClient, ensureFreshSession } from '@/lib/supabase/client'
import { KNOWLEDGE_BUCKET, MAX_UPLOAD_BYTES, UPLOAD_ACCEPT, UPLOAD_EXT_RE, formatBytes } from '@/lib/knowledge/constants'
import Button from '@/components/ui/Button'
import type { KnowledgeTopic } from '@/types'

type FileState = 'queued' | 'uploading' | 'processing' | 'ready' | 'needs_attention' | 'failed'
interface Row {
  file: File
  state: FileState
  message?: string
}

const CONCURRENCY = 2

// US-102: several files at once (the first bulk upload of existing material).
// Each file: signed upload straight to Storage → create a draft item → ask the
// server to extract its text. Files run two at a time so one huge PDF doesn't
// block the rest, and each one's status is shown as it lands.
export default function BulkUpload({ departmentId, topics, defaultTopicId }: { departmentId: string; topics: KnowledgeTopic[]; defaultTopicId?: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [topicId, setTopicId] = useState(defaultTopicId && defaultTopicId !== 'unsorted' ? defaultTopicId : '')
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)

  const update = (idx: number, patch: Partial<Row>) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x)))

  function addFiles(list: FileList | null) {
    if (!list) return
    const next: Row[] = Array.from(list).map((file) => {
      if (!UPLOAD_EXT_RE.test(file.name)) return { file, state: 'failed', message: 'Not a PDF, Word (.docx) or text file' }
      if (file.size > MAX_UPLOAD_BYTES) return { file, state: 'failed', message: 'Larger than 100 MB' }
      return { file, state: 'queued' }
    })
    setRows((r) => [...r, ...next])
  }

  async function processOne(idx: number, file: File) {
    try {
      update(idx, { state: 'uploading', message: undefined })
      const supabase = getSupabaseBrowserClient()
      await ensureFreshSession(supabase)
      const urlRes = await fetch('/api/knowledge/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentId, filename: file.name, size: file.size, purpose: 'item' }),
      })
      const urlData = await urlRes.json()
      if (!urlRes.ok) throw new Error(urlData.error || 'Upload refused')
      const { error: upErr } = await supabase.storage.from(KNOWLEDGE_BUCKET).uploadToSignedUrl(urlData.path, urlData.token, file, {
        contentType: file.type || undefined,
      })
      if (upErr) throw new Error(upErr.message)

      const itemRes = await fetch('/api/knowledge/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentId,
          topicId: topicId || null,
          type: 'document',
          file: { path: urlData.path, name: file.name, mime: file.type || null, size: file.size },
        }),
      })
      const itemData = await itemRes.json()
      if (!itemRes.ok) throw new Error(itemData.error || 'Could not create the item')

      update(idx, { state: 'processing' })
      const exRes = await fetch(`/api/knowledge/versions/${itemData.version.id}/extract`, { method: 'POST' })
      const exData = await exRes.json().catch(() => ({}))
      if (!exRes.ok) throw new Error(exData.error || 'Processing failed — retry it from the content table')
      const status = exData.version?.extraction_status as string | undefined
      if (status === 'ready') update(idx, { state: 'ready' })
      else if (status === 'needs_attention') update(idx, { state: 'needs_attention', message: exData.version?.extraction_error })
      else update(idx, { state: 'failed', message: exData.version?.extraction_error || 'Processing failed' })
    } catch (err) {
      update(idx, { state: 'failed', message: err instanceof Error ? err.message : 'Upload failed' })
    }
  }

  async function start() {
    setRunning(true)
    const queue = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.state === 'queued')
    let cursor = 0
    const worker = async () => {
      while (cursor < queue.length) {
        const { r, i } = queue[cursor++]
        await processOne(i, r.file)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    setRunning(false)
    router.refresh()
  }

  const queued = rows.filter((r) => r.state === 'queued').length

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} className="gap-2">
        <span className="inline-flex items-center gap-2"><Upload size={13} /> Upload documents</span>
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="modal-backdrop-in absolute inset-0 bg-black/40" onClick={running ? undefined : () => { setOpen(false); setRows([]) }} />
      <div className="modal-panel-in relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#e5e3df] p-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Upload documents</h3>
            <p className="mt-1 text-xs text-gray-500">PDF, Word (.docx) or plain text — any size. Each file becomes a draft; nothing is used by the AI until you publish it.</p>
          </div>
          {!running && (
            <button onClick={() => { setOpen(false); setRows([]) }} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X size={16} /></button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Topic</span>
            <select
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              disabled={running}
              className="mt-1.5 w-full border-b border-gray-300 bg-transparent py-2 text-sm focus:border-black focus:outline-none"
            >
              <option value="">Unsorted</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>

          <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center hover:border-gray-500">
            <Upload size={20} className="text-gray-400" />
            <span className="text-sm text-gray-700">Choose files</span>
            <span className="text-[11px] text-gray-400">You can select several at once</span>
            <input type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" disabled={running} onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          </label>

          {rows.length > 0 && (
            <ul className="mt-4 flex flex-col divide-y divide-[#f0efec] rounded-lg border border-[#e5e3df]">
              {rows.map((r, i) => (
                <li key={`${r.file.name}-${i}`} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="mt-0.5 flex-shrink-0">
                    {r.state === 'ready' ? <CheckCircle2 size={15} className="text-emerald-600" />
                      : r.state === 'needs_attention' || r.state === 'failed' ? <AlertTriangle size={15} className={r.state === 'failed' ? 'text-red-600' : 'text-amber-600'} />
                      : r.state === 'queued' ? <span className="block h-[15px] w-[15px] rounded-full border border-gray-300" />
                      : <Loader2 size={15} className="animate-spin text-gray-500" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-gray-900">{r.file.name}</p>
                    <p className={`text-[11px] ${r.state === 'failed' ? 'text-red-600' : r.state === 'needs_attention' ? 'text-amber-700' : 'text-gray-500'}`}>
                      {r.state === 'queued' && formatBytes(r.file.size)}
                      {r.state === 'uploading' && 'Uploading…'}
                      {r.state === 'processing' && 'Reading text…'}
                      {r.state === 'ready' && 'Ready — draft created'}
                      {(r.state === 'needs_attention' || r.state === 'failed') && (r.message || 'Couldn’t be read')}
                    </p>
                  </div>
                  {r.state === 'queued' && !running && (
                    <button onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="text-gray-300 hover:text-gray-600" aria-label="Remove"><X size={13} /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex gap-3 border-t border-[#e5e3df] p-5">
          <Button variant="secondary" size="sm" disabled={running} onClick={() => { setOpen(false); setRows([]) }} className="flex-1 justify-center">
            {rows.some((r) => r.state !== 'queued') ? 'Close' : 'Cancel'}
          </Button>
          <Button size="sm" onClick={start} disabled={queued === 0} loading={running} className="flex-1 justify-center">
            Upload {queued > 0 ? `${queued} file${queued === 1 ? '' : 's'}` : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
