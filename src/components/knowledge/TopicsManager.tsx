'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, Check, X, Hash } from 'lucide-react'
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
    `relative flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
      active ? 'bg-[#f3f1ec] font-medium text-gray-900' : 'text-gray-600 hover:bg-[#faf9f7] hover:text-gray-900'
    }`
  const activeBar = <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[#c8973f]" />

  return (
    <aside className="self-start rounded-2xl border border-[#e5e3df] bg-white p-3 shadow-sm lg:sticky lg:top-6">
      <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Topics</p>
      <ul className="flex flex-col gap-0.5">
        <li>
          <Link href={basePath} className={linkCls(!activeTopic)}>
            {!activeTopic && activeBar}
            <span>All items</span>
            <span className="text-[11px] tabular-nums text-gray-400">{counts.__all ?? 0}</span>
          </Link>
        </li>
        {topics.map((t, i) => (
          <li key={t.id} className="group flex items-center gap-1">
            {editing === t.id ? (
              <form
                className="flex flex-1 items-center gap-1 rounded-lg bg-[#faf9f7] px-1.5 py-1"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (await call(`/api/knowledge/topics/${t.id}`, 'PATCH', { name: editName })) setEditing(null)
                }}
              >
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[13px] focus:outline-none"
                />
                <button type="submit" disabled={busy} className="rounded p-1 text-gray-500 hover:bg-white hover:text-black" title="Save">
                  <Check size={13} />
                </button>
                <button type="button" onClick={() => setEditing(null)} className="rounded p-1 text-gray-400 hover:bg-white hover:text-black" title="Cancel">
                  <X size={13} />
                </button>
              </form>
            ) : (
              <>
                <Link href={`${basePath}?topic=${t.id}`} className={linkCls(activeTopic === t.id)}>
                  {activeTopic === t.id && activeBar}
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Hash size={11} className="flex-shrink-0 text-gray-300" />
                    <span className="truncate">{t.name}</span>
                  </span>
                  <span className={`text-[11px] tabular-nums text-gray-400 ${canEdit ? 'group-hover:hidden' : ''}`}>{counts[t.id] ?? 0}</span>
                </Link>
                {canEdit && (
                  <div className="hidden flex-shrink-0 items-center group-hover:flex">
                    <button title="Move up" disabled={busy || i === 0} onClick={() => call(`/api/knowledge/topics/${t.id}`, 'PATCH', { move: 'up' })} className="rounded p-0.5 text-gray-400 hover:text-black disabled:opacity-30">
                      <ChevronUp size={13} />
                    </button>
                    <button
                      title="Move down"
                      disabled={busy || i === topics.length - 1}
                      onClick={() => call(`/api/knowledge/topics/${t.id}`, 'PATCH', { move: 'down' })}
                      className="rounded p-0.5 text-gray-400 hover:text-black disabled:opacity-30"
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      title="Rename"
                      onClick={() => {
                        setEditing(t.id)
                        setEditName(t.name)
                      }}
                      className="rounded p-0.5 text-gray-400 hover:text-black"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      title="Delete topic"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete the topic “${t.name}”? Its items stay, under “Unsorted”.`)) call(`/api/knowledge/topics/${t.id}`, 'DELETE')
                      }}
                      className="rounded p-0.5 text-gray-400 hover:text-red-600"
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
              {activeTopic === 'unsorted' && activeBar}
              <span className="italic">Unsorted</span>
              <span className="text-[11px] tabular-nums text-gray-400">{counts.__unsorted}</span>
            </Link>
          </li>
        )}
      </ul>
      {topics.length === 0 && <p className="px-2 pt-1 text-[11px] leading-4 text-gray-400">Group items into topics (e.g. Interviews, Style, Onboarding) so they’re easy to browse.</p>}
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
            placeholder="Add a topic…"
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-[#faf9f7] px-2.5 py-1.5 text-[13px] placeholder:text-gray-400 focus:border-[#e5e3df] focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="rounded-lg bg-black p-1.5 text-white transition-colors hover:bg-gray-900 disabled:bg-gray-200 disabled:text-gray-400"
            title="Add topic"
          >
            <Plus size={14} />
          </button>
        </form>
      )}
      {error && <p className="mt-2 px-1 text-[11px] text-red-600">{error}</p>}
    </aside>
  )
}
