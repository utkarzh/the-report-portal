'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, PlayCircle } from 'lucide-react'
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
  const [topicId, setTopicId] = useState(defaultTopicId && defaultTopicId !== 'unsorted' ? defaultTopicId : '')
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
    <form onSubmit={submit} className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
      <div className="flex flex-col gap-6 p-6">
        {type === 'link' && (
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { key: 'video', icon: PlayCircle, title: 'Training video', sub: 'Loom, YouTube, Vimeo…' },
                { key: 'link', icon: Link2, title: 'Resource link', sub: 'SharePoint, Drive, a website…' },
              ] as const
            ).map(({ key, icon: Icon, title: label, sub }) => (
              <button
                key={key}
                type="button"
                onClick={() => setKind(key)}
                className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                  kind === key ? 'border-black bg-[#faf9f7] ring-1 ring-black' : 'border-[#e5e3df] hover:border-gray-400'
                }`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${kind === key ? 'bg-black text-white' : 'bg-[#f7f6f3] text-gray-500'}`}>
                  <Icon size={16} />
                </span>
                <span>
                  <span className="block text-sm font-medium text-gray-900">{label}</span>
                  <span className="block text-[11px] text-gray-500">{sub}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <Input
          label="Title *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          placeholder={type === 'text' ? 'e.g. How to prepare an interview outline' : 'e.g. HubSpot basics — logging a call'}
        />
        <Textarea
          label={type === 'link' ? 'Short description *' : 'Short description'}
          hint={type === 'link' ? 'The AI finds this item by its title and description' : 'Shown in Browse and search results'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          required={type === 'link'}
          placeholder={type === 'link' ? 'What it covers and when someone should watch or open it.' : 'One or two sentences on what this guide covers.'}
        />
        {type === 'link' && <Input label="Link *" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://www.loom.com/share/…" />}
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Topic</span>
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)} className="rounded-lg border border-[#e5e3df] bg-white px-3 py-2 text-sm focus:border-black focus:outline-none">
            <option value="">Unsorted</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {type === 'text' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Content *</span>
            <MarkdownEditor value={content} onChange={setContent} />
          </div>
        )}
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-b-2xl border-t border-[#eceae5] bg-[#fcfbf9] px-6 py-4">
        <Button type="submit" size="sm" loading={busy}>
          Save as draft
        </Button>
        <p className="text-[11px] text-gray-400">Drafts aren’t visible to colleagues or used by the AI until you publish.</p>
      </div>
    </form>
  )
}
