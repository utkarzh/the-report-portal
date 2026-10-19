'use client'

import { useState } from 'react'
import { FileText, Upload, Loader2, Eye, Trash2 } from 'lucide-react'
import FileViewerModal from '@/components/copywriting/FileViewerModal'
import { uploadToStorage, type StagedFile } from '@/lib/copywriting-upload'
import { PUBLICATION_GUIDES_BUCKET, MAX_PUBLICATION_GUIDES } from '@/lib/copywriting'

export interface PublicationGuide {
  id: string
  filename: string
  char_count: number
  truncated: boolean
  created_at: string
}

// A publication's Copywriting style-guide files (moved here from the old
// Copywriting "Publications" admin page; same API routes and storage).
export default function PublicationGuides({ publicationId, initialGuides }: { publicationId: string; initialGuides: PublicationGuide[] }) {
  const [guides, setGuides] = useState(initialGuides)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const base = `/api/copywriting/admin/publications/${publicationId}/guides`

  async function upload(files: File[]) {
    if (!files.length) return
    setUploading(true)
    setError(null)
    // Straight to Supabase Storage from the browser, then the API gets only
    // the paths (no file bytes → no ~4.5 MB Vercel request limit).
    const staged: StagedFile[] = []
    const failures: string[] = []
    for (const f of files) {
      try {
        staged.push(await uploadToStorage(PUBLICATION_GUIDES_BUCKET, publicationId, f))
      } catch (e) {
        failures.push(`${f.name}: ${e instanceof Error ? e.message : 'Upload failed'}`)
      }
    }
    if (staged.length) {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: staged }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.uploaded?.length) setGuides((prev) => [...prev, ...data.uploaded])
      if (data.errors?.length) failures.push(...data.errors.map((e: { filename: string; error: string }) => `${e.filename}: ${e.error}`))
      else if (!res.ok) failures.push(data.error || 'Upload failed')
    }
    if (failures.length) setError(failures.join('; '))
    setUploading(false)
  }

  async function remove(guideId: string) {
    const res = await fetch(`${base}/${guideId}`, { method: 'DELETE' })
    if (res.ok) setGuides((prev) => prev.filter((g) => g.id !== guideId))
    else setError('Failed to remove the file.')
  }

  return (
    <div className="flex flex-col gap-2">
      {guides.map((g) => (
        <div key={g.id} className="flex items-center justify-between gap-2 rounded bg-gray-50 px-3 py-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 text-gray-600">
            <FileText size={12} className="flex-shrink-0" />
            <span className="truncate">{g.filename}</span>
          </span>
          <span className="flex flex-shrink-0 items-center gap-3">
            <button type="button" onClick={() => setViewing(`${base}/${g.id}`)} className="inline-flex items-center gap-1 text-gray-500 hover:text-black">
              <Eye size={12} /> View
            </button>
            <button type="button" onClick={() => remove(g.id)} className="text-gray-400 hover:text-red-500" aria-label="Remove">
              <Trash2 size={12} />
            </button>
          </span>
        </div>
      ))}
      {guides.length === 0 && <p className="text-xs text-gray-400">No style guides.</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {guides.length < MAX_PUBLICATION_GUIDES && (
        <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 self-start text-xs text-gray-500 transition-colors hover:text-black">
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Add guide (.pdf, .docx)
          <input type="file" multiple accept=".pdf,.docx" className="hidden" disabled={uploading} onChange={(e) => { const picked = Array.from(e.target.files || []); e.target.value = ''; upload(picked) }} />
        </label>
      )}
      <FileViewerModal endpoint={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}
