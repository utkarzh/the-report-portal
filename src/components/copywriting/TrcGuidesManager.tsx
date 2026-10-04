'use client'

import { useEffect, useState } from 'react'
import { FileText, Trash2, Upload, Loader2, Eye } from 'lucide-react'
import FileViewerModal from '@/components/copywriting/FileViewerModal'
import Select from '@/components/ui/Select'
import { uploadToStorage, type StagedFile } from '@/lib/copywriting-upload'
import { TRC_GUIDES_BUCKET } from '@/lib/copywriting'

interface Guide {
  id: string
  article_type_id: string
  kind: 'guide' | 'example'
  filename: string
  char_count: number
  truncated: boolean
  created_at: string
}

interface ArticleType {
  id: string
  name: string
}

export default function TrcGuidesManager({ articleTypes }: { articleTypes: ArticleType[] }) {
  const [articleTypeId, setArticleTypeId] = useState(articleTypes[0]?.id || '')
  const [guides, setGuides] = useState<Guide[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState<'guide' | 'example' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function load(id: string) {
    if (!id) return
    setLoading(true)
    const res = await fetch(`/api/copywriting/admin/trc-guides?articleTypeId=${id}`)
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    setGuides(data.guides || [])
  }

  useEffect(() => {
    load(articleTypeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleTypeId])

  async function upload(kind: 'guide' | 'example', files: FileList | null) {
    if (!files || !files.length || !articleTypeId) return
    setUploading(kind)
    setUploadError(null)
    // Straight to Supabase Storage from the browser, then the API gets only
    // the paths (no file bytes → no ~4.5 MB Vercel request limit).
    const staged: StagedFile[] = []
    const failures: string[] = []
    for (const f of Array.from(files)) {
      try {
        staged.push(await uploadToStorage(TRC_GUIDES_BUCKET, `${articleTypeId}/${kind}`, f))
      } catch (e) {
        failures.push(`${f.name}: ${e instanceof Error ? e.message : 'Upload failed'}`)
      }
    }
    if (staged.length) {
      const res = await fetch('/api/copywriting/admin/trc-guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleTypeId, kind, files: staged }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.errors?.length) failures.push(...data.errors.map((e: { filename: string; error: string }) => `${e.filename}: ${e.error}`))
      else if (!res.ok) failures.push(data.error || 'Upload failed')
    }
    if (failures.length) setUploadError(failures.join('; '))
    setUploading(null)
    await load(articleTypeId)
  }

  async function remove(id: string) {
    await fetch(`/api/copywriting/admin/trc-guides/${id}`, { method: 'DELETE' })
    await load(articleTypeId)
  }

  const trcGuides = guides.filter((g) => g.kind === 'guide')
  const trcExamples = guides.filter((g) => g.kind === 'example')

  return (
    <div className="flex flex-col gap-8">
      <div className="bg-white border border-[#e5e3df] p-6 sm:p-8">
        <Select
          label="Article type"
          value={articleTypeId}
          onChange={(e) => setArticleTypeId(e.target.value)}
          options={articleTypes.map((t) => ({ value: t.id, label: t.name }))}
        />
        <p className="mt-2 text-xs text-gray-400">TRC guides are associated with the article type, irrespective of any publication.</p>
        {uploadError && <p className="mt-2 text-xs text-red-500">Upload failed — {uploadError}</p>}
      </div>

      {loading ? (
        <Loader2 size={16} className="animate-spin text-gray-400" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <GuideList
            title="TRC Guides"
            description="Style/structure guides for this article type."
            items={trcGuides}
            uploading={uploading === 'guide'}
            onUpload={(files) => upload('guide', files)}
            onRemove={remove}
          />
          <GuideList
            title="TRC Examples"
            description="Approved worked examples that show the standard to match."
            items={trcExamples}
            uploading={uploading === 'example'}
            onUpload={(files) => upload('example', files)}
            onRemove={remove}
          />
        </div>
      )}
    </div>
  )
}

function GuideList({
  title,
  description,
  items,
  uploading,
  onUpload,
  onRemove,
}: {
  title: string
  description: string
  items: Guide[]
  uploading: boolean
  onUpload: (files: FileList | null) => void
  onRemove: (id: string) => void
}) {
  const [viewing, setViewing] = useState<string | null>(null)
  return (
    <div className="bg-white border border-[#e5e3df] p-6">
      <FileViewerModal endpoint={viewing ? `/api/copywriting/admin/trc-guides/${viewing}` : null} onClose={() => setViewing(null)} />
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-500 mt-1">{description}</p>

      <div className="mt-4 flex flex-col gap-1.5">
        {items.map((g) => (
          <div key={g.id} className="flex items-center justify-between gap-2 text-xs bg-gray-50 px-3 py-2 rounded">
            <span className="flex items-center gap-1.5 min-w-0 text-gray-600">
              <FileText size={12} className="flex-shrink-0" />
              <span className="truncate">{g.filename}</span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-3">
              <button onClick={() => setViewing(g.id)} className="inline-flex items-center gap-1 text-gray-500 hover:text-black">
                <Eye size={12} /> View
              </button>
              <button onClick={() => onRemove(g.id)} className="text-gray-400 hover:text-red-500" aria-label="Remove">
                <Trash2 size={12} />
              </button>
            </span>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-gray-400">None uploaded yet.</p>}
      </div>

      <label className="mt-3 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black cursor-pointer transition-colors">
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        Upload (multiple allowed)
        <input type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
      </label>
    </div>
  )
}
