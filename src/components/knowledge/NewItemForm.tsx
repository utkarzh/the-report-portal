'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import MarkdownEditor from '@/components/knowledge/MarkdownEditor'
import type { KnowledgeTopic } from '@/types'

// New guide written in the platform (US-103) or a video/resource link
// (US-104). Saved as a draft; the editor it lands on has Publish.
export default function NewItemForm({
  departmentId,
  type,
  topics,
  defaultTopicId,
  basePath,
  prefill,
}: {
  departmentId: string
  type: 'text' | 'link'
  topics: KnowledgeTopic[]
  defaultTopicId: string | null
  basePath: string
  prefill?: { title?: string; content?: string; url?: string }
}) {
  const router = useRouter()
  const [kind, setKind] = useState<'video' | 'link'>('video')
  const [title, setTitle] = useState(prefill?.title ?? '')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState(prefill?.content ?? '')
  const [url, setUrl] = useState(prefill?.url ?? '')
  const [topicId, setTopicId] = useState(defaultTopicId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/knowledge/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        departmentId,
        topicId: topicId || null,
        type: type === 'text' ? 'text' : kind,
        title,
        description,
        content: type === 'text' ? content : undefined,
        url: type === 'link' ? url : undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setBusy(false)
      setError(data.error || 'Could not save.')
      return
    }
    router.push(`${basePath}/items/${data.item.id}`)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-xl border border-[#e5e3df] bg-white p-6">
      {type === 'link' && (
        <div className="flex gap-2">
          {(['video', 'link'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${kind === k ? 'bg-black text-white' : 'border border-[#e5e3df] text-gray-600 hover:bg-gray-50'}`}
            >
              {k === 'video' ? 'Training video (Loom, YouTube…)' : 'Resource link (SharePoint, website…)'}
            </button>
          ))}
        </div>
      )}
      <Input label="Title *" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder={type === 'text' ? 'e.g. How to prepare an interview outline' : 'e.g. HubSpot basics — logging a call'} />
      <Textarea
        label={type === 'link' ? 'Short description *' : 'Short description'}
        hint={type === 'link' ? 'The AI finds this item by its title and description' : undefined}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        required={type === 'link'}
      />
      {type === 'link' && <Input label="Link *" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://www.loom.com/share/…" />}
      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Topic</span>
        <select value={topicId} onChange={(e) => setTopicId(e.target.value)} className="border-b border-gray-300 bg-transparent py-2 text-sm focus:border-black focus:outline-none">
          <option value="">Unsorted</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {type === 'text' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Content *</span>
          <MarkdownEditor value={content} onChange={setContent} />
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" loading={busy}>Save as draft</Button>
        <p className="text-[11px] text-gray-400">Drafts aren’t visible to users or used by the AI until you publish.</p>
      </div>
    </form>
  )
}
