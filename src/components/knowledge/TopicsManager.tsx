'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, Check, X } from 'lucide-react'
import type { KnowledgeTopic } from '@/types'

// US-101: the Guardian creates, renames and orders topics. Also doubles as
// the content table's topic filter.
export default function TopicsManager({
  departmentId,
  topics,
  counts,
  activeTopic,
  canEdit,
  basePath,
}: {
  departmentId: string
  topics: KnowledgeTopic[]
  counts: Record<string, number>
  activeTopic: string | null
  canEdit: boolean
  basePath: string
}) {
  const router = useRouter()
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true)
    setError(null)
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return false
    }
    router.refresh()
    return true
  }

  const linkCls = (active: boolean) =>
    `flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] ${
      active ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'
    }`

  return (
    <div className="rounded-xl border border-[#e5e3df] bg-white p-3">
      <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Topics</p>
      <ul className="flex flex-col gap-0.5">
        <li>
          <Link href={basePath} className={linkCls(!activeTopic)}>
            <span>All items</span>
            <span className="text-[11px] opacity-70">{counts.__all ?? 0}</span>
          </Link>
        </li>
        {topics.map((t, i) => (
          <li key={t.id} className="group flex items-center gap-1">
            {editing === t.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (await call(`/api/knowledge/topics/${t.id}`, 'PATCH', { name: editName })) setEditing(null)
                }}
              >
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="min-w-0 flex-1 border-b border-gray-300 px-1 py-1 text-[13px] focus:border-black focus:outline-none"
                />
                <button type="submit" disabled={busy} className="p-1 text-gray-500 hover:text-black"><Check size={13} /></button>
                <button type="button" onClick={() => setEditing(null)} className="p-1 text-gray-400 hover:text-black"><X size={13} /></button>
              </form>
            ) : (
              <>
                <Link href={`${basePath}?topic=${t.id}`} className={linkCls(activeTopic === t.id)}>
                  <span className="truncate">{t.name}</span>
                  <span className="text-[11px] opacity-70">{counts[t.id] ?? 0}</span>
                </Link>
                {canEdit && (
                  <div className="flex flex-shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                    <button title="Move up" disabled={busy || i === 0} onClick={() => call(`/api/knowledge/topics/${t.id}`, 'PATCH', { move: 'up' })} className="p-0.5 text-gray-400 hover:text-black disabled:opacity-30"><ChevronUp size={13} /></button>
                    <button title="Move down" disabled={busy || i === topics.length - 1} onClick={() => call(`/api/knowledge/topics/${t.id}`, 'PATCH', { move: 'down' })} className="p-0.5 text-gray-400 hover:text-black disabled:opacity-30"><ChevronDown size={13} /></button>
                    <button title="Rename" onClick={() => { setEditing(t.id); setEditName(t.name) }} className="p-0.5 text-gray-400 hover:text-black"><Pencil size={12} /></button>
                    <button
                      title="Delete topic"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete the topic “${t.name}”? Its items stay, under “Unsorted”.`)) call(`/api/knowledge/topics/${t.id}`, 'DELETE')
                      }}
                      className="p-0.5 text-gray-400 hover:text-red-600"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
        {(counts.__unsorted ?? 0) > 0 && (
          <li>
            <Link href={`${basePath}?topic=unsorted`} className={linkCls(activeTopic === 'unsorted')}>
              <span className="italic">Unsorted</span>
              <span className="text-[11px] opacity-70">{counts.__unsorted}</span>
            </Link>
          </li>
        )}
      </ul>
      {canEdit && (
        <form
          className="mt-3 flex items-center gap-1 border-t border-[#f0efec] pt-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!newName.trim()) return
            if (await call('/api/knowledge/topics', 'POST', { departmentId, name: newName })) setNewName('')
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New topic…"
            className="min-w-0 flex-1 border-b border-gray-300 bg-transparent px-1 py-1.5 text-[13px] placeholder:text-gray-400 focus:border-black focus:outline-none"
          />
          <button type="submit" disabled={busy || !newName.trim()} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-black disabled:opacity-30" title="Add topic">
            <Plus size={14} />
          </button>
        </form>
      )}
      {error && <p className="mt-2 px-1 text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
