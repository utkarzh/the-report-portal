'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArchiveRestore, ChevronDown, Eye, FolderOpen, Loader2, MessageSquareWarning, Pencil, Search, Trash2, Upload, X } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import RetryExtractionButton from '@/components/knowledge/RetryExtractionButton'
import ItemRowPanel from '@/components/knowledge/ItemRowPanel'
import { ExampleBadge, TypeTile } from '@/components/knowledge/kb-ui'
import { ITEM_TYPE_LABELS, type ItemDisplayState } from '@/lib/knowledge/constants'
import { kbApi, publishKnowledgeItem } from '@/lib/knowledge/client-actions'
import { formatDayMonthYear } from '@/lib/date-format'
import type { ContentRow } from '@/lib/knowledge/manage-data'
import type { KnowledgeTopic } from '@/types'

type StatusFilter = 'all' | 'published' | 'drafts' | 'attention' | 'archived'

const FILTERS: { key: StatusFilter; label: string; match: (s: ItemDisplayState) => boolean }[] = [
  { key: 'all', label: 'All', match: (s) => s !== 'archived' },
  { key: 'published', label: 'Published', match: (s) => s === 'published' || s === 'published_with_draft' },
  // Every item with a pending draft — including one whose file needs attention.
  { key: 'drafts', label: 'Drafts', match: (s) => s === 'draft' || s === 'published_with_draft' || s === 'processing' || s === 'needs_attention' },
  { key: 'attention', label: 'Needs attention', match: (s) => s === 'needs_attention' },
  { key: 'archived', label: 'Archived', match: (s) => s === 'archived' },
]

// US-119: every item in a department in one list. Each row says in words
// which version is live and whether a newer one is waiting ("Live v2 →
// Draft v3"), and carries its own Publish button. Clicking a row opens
// everything about the item in place (ItemRowPanel) — edit, publish, history,
// restore, file, topic, example, archive, delete — so there's no second page.
// Items needing attention are listed first. With delete rights (the Guardian
// or an admin) rows can be ticked and deleted together.
export default function ContentTable({
  rows,
  canEdit,
  canDelete = false,
  departmentId,
  basePath,
  topics,
  initialOpenId = null,
}: {
  rows: ContentRow[]
  canEdit: boolean
  canDelete?: boolean
  departmentId: string
  basePath: string
  topics: KnowledgeTopic[]
  initialOpenId?: string | null
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>(() => {
    const opened = rows.find((r) => r.item.id === initialOpenId)
    return opened?.state === 'archived' ? 'archived' : 'all'
  })
  const [openId, setOpenId] = useState<string | null>(initialOpenId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<{ id: string; progress: string } | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const openRef = useRef<HTMLDivElement | null>(null)
  const selecting = canDelete

  // A link to one item (the old item page, the review queue, a new upload)
  // arrives with ?item=… — bring that row into view, already open.
  useEffect(() => {
    if (initialOpenId) openRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleOpen(id: string) {
    const next = openId === id ? null : id
    setOpenId(next)
    // Keep the URL shareable without a server round trip.
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('item', next)
    else url.searchParams.delete('item')
    window.history.replaceState(null, '', url.toString())
  }

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => f.match(r.state)).length])) as Record<StatusFilter, number>, [rows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = FILTERS.find((f) => f.key === filter)!.match
    const rank = (r: ContentRow) => (r.state === 'needs_attention' ? 0 : r.state === 'processing' ? 1 : 2)
    return rows
      .filter((r) => match(r.state) || r.item.id === openId)
      .filter((r) => !q || r.item.title.toLowerCase().includes(q) || (r.topicName ?? '').toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b))
  }, [rows, query, filter, openId])

  // Only rows that still exist count (a refresh may have removed some).
  const selectedIds = rows.filter((r) => selected.has(r.item.id)).map((r) => r.item.id)
  const visibleIds = visible.map((r) => r.item.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAllVisible = () =>
    setSelected((s) => {
      const next = new Set(s)
      visibleIds.forEach((id) => (allVisibleSelected ? next.delete(id) : next.add(id)))
      return next
    })

  async function deleteSelected() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/knowledge/items/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentId, ids: selectedIds }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not delete the items')
      setSelected(new Set())
      setConfirmDelete(false)
      if (openId && selectedIds.includes(openId)) setOpenId(null)
      router.refresh()
    } catch (err) {
      setConfirmDelete(false)
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the items')
    } finally {
      setDeleting(false)
    }
  }

  async function publishRow(r: ContentRow) {
    setPublishing({ id: r.item.id, progress: 'Publishing…' })
    setRowError(null)
    try {
      await publishKnowledgeItem(r.item.id, (progress) => setPublishing({ id: r.item.id, progress }))
      router.refresh()
    } catch (err) {
      setRowError({ id: r.item.id, message: err instanceof Error ? err.message : 'Could not publish' })
    } finally {
      setPublishing(null)
    }
  }

  async function unarchiveRow(r: ContentRow) {
    setPublishing({ id: r.item.id, progress: 'Restoring…' })
    setRowError(null)
    try {
      await kbApi(`/api/knowledge/items/${r.item.id}/archive`, 'POST', { archive: false })
      router.refresh()
    } catch (err) {
      setRowError({ id: r.item.id, message: err instanceof Error ? err.message : 'Could not unarchive' })
    } finally {
      setPublishing(null)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#d9d5cc] bg-white/60 px-4 py-14 text-center sm:px-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#eceae5] bg-white text-gray-500 shadow-sm">
          <FolderOpen size={19} strokeWidth={1.75} />
        </span>
        <p className="mt-4 text-sm font-semibold text-gray-900">No items here yet</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-gray-500">
          {canEdit
            ? 'Upload existing documents, write a guide or add a training video. Everything starts as a draft — users only see it once you publish.'
            : 'When the Guardian adds knowledge to this department it will be listed here.'}
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0).map((f) => {
            const on = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors touch:py-2.5 ${
                  on
                    ? f.key === 'attention'
                      ? 'bg-red-600 text-white'
                      : 'bg-black text-white'
                    : 'border border-[#e5e3df] bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
                }`}
              >
                {f.key === 'attention' && <AlertTriangle size={11} />}
                {f.label}
                <span className={`tabular-nums ${on ? 'text-white/70' : 'text-gray-400'}`}>{counts[f.key]}</span>
              </button>
            )
          })}
        </div>
        <div className="relative sm:w-64">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title or topic"
            className="w-full rounded-full border border-[#e5e3df] bg-white py-2 pl-8 pr-3 text-xs placeholder:text-gray-400 focus:border-black focus:outline-none"
          />
        </div>
      </div>

      {selecting && (selectedIds.length > 0 || deleteError) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e5e3df] bg-[#faf9f7] px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            {selectedIds.length > 0 && (
              <>
                <span className="font-semibold text-gray-900">{selectedIds.length} selected</span>
                <button type="button" onClick={toggleAllVisible} className="font-medium text-gray-600 touch:py-2 hover:text-black">
                  {allVisibleSelected ? 'Unselect all shown' : `Select all ${visibleIds.length} shown`}
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="font-medium text-gray-600 touch:py-2 hover:text-black">
                  Clear
                </button>
              </>
            )}
            {deleteError && <span className="text-red-600">{deleteError}</span>}
          </div>
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors touch:py-2.5 hover:bg-red-700"
            >
              <Trash2 size={13} /> Delete selected
            </button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
        <div className="hidden items-center gap-4 border-b border-[#e5e3df] bg-[#fcfbf9] px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 lg:flex">
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            {selecting && <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all shown" className="h-3.5 w-3.5 accent-black" />}
            Item
          </span>
          <span className="w-60 flex-shrink-0">Version</span>
          <span className="w-44 flex-shrink-0 text-right">Action</span>
          <span className="w-4 flex-shrink-0" />
        </div>

        {visible.length === 0 && <p className="px-4 py-10 text-center text-xs text-gray-400">No items match.</p>}

        <ul className="divide-y divide-[#f0efec]">
          {visible.map((r) => {
            const open = openId === r.item.id
            const attention = r.state === 'needs_attention'
            const pubBusy = publishing?.id === r.item.id
            const err = rowError?.id === r.item.id ? rowError.message : null
            return (
              <li key={r.item.id} className={open ? 'bg-white' : ''}>
                <div ref={open ? openRef : undefined} className="scroll-mt-20">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggleOpen(r.item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleOpen(r.item.id)
                      }
                    }}
                    className={`group flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5 outline-none transition-colors focus-visible:bg-[#faf9f7] lg:flex-nowrap ${
                      open ? 'bg-[#faf9f7]' : attention ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-[#faf9f7]'
                    }`}
                  >
                    {/* Item */}
                    <div className="flex min-w-0 flex-1 basis-full items-start gap-3 lg:basis-auto">
                      {selecting && (
                        // Ticking a row never opens it.
                        <label onClick={(e) => e.stopPropagation()} className="-m-2 flex cursor-pointer items-center self-center p-2">
                          <input
                            type="checkbox"
                            checked={selected.has(r.item.id)}
                            onChange={() => toggle(r.item.id)}
                            aria-label={`Select ${r.item.title}`}
                            className="h-4 w-4 accent-black"
                          />
                        </label>
                      )}
                      <TypeTile type={r.item.type} size="sm" example={r.item.is_example} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-gray-900">{r.item.title}</span>
                          {r.item.is_example && <ExampleBadge compact />}
                          {r.openFeedback > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700" title="Open feedback">
                              <MessageSquareWarning size={10} /> {r.openFeedback}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          {ITEM_TYPE_LABELS[r.item.type]} · {r.topicName ?? <span className="italic">Unsorted</span>}
                        </p>
                        {attention && r.draft?.extraction_error && (
                          <p className="mt-1 flex items-start gap-1 text-[11px] text-red-700">
                            <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /> {r.draft.extraction_error}
                          </p>
                        )}
                        {r.state === 'processing' && r.stalled && canEdit && r.draft && (
                          <p onClick={(e) => e.stopPropagation()} className="mt-1 flex items-center gap-2 text-[11px] text-amber-700">
                            Processing stopped. <RetryExtractionButton versionId={r.draft.id} />
                          </p>
                        )}
                        {err && <p className="mt-1 text-[11px] text-red-700">{err}</p>}
                      </div>
                    </div>

                    {/* Version */}
                    <div className="w-full pl-11 lg:w-60 lg:flex-shrink-0 lg:pl-0">
                      <VersionLine row={r} />
                    </div>

                    {/* Action */}
                    <div className="flex flex-1 justify-end lg:w-44 lg:flex-none lg:flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <RowAction
                        row={r}
                        open={open}
                        canEdit={canEdit}
                        busy={pubBusy}
                        progress={pubBusy ? publishing!.progress : null}
                        onPublish={() => publishRow(r)}
                        onOpen={() => toggleOpen(r.item.id)}
                        onUnarchive={() => unarchiveRow(r)}
                      />
                    </div>

                    {/* Edit / View / Close carry their own arrow; other actions keep it beside them. */}
                    {rowActionToggles(r, open, canEdit) ? (
                      <span className="hidden w-4 flex-shrink-0 lg:block" />
                    ) : (
                      <ChevronDown
                        size={16}
                        className={`w-4 flex-shrink-0 text-gray-300 transition-transform duration-200 group-hover:text-gray-500 ${open ? 'rotate-180 text-gray-500' : ''}`}
                      />
                    )}
                  </div>
                  {open && <ItemRowPanel itemId={r.item.id} basePath={basePath} departmentId={departmentId} topics={topics} />}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Showing {visible.length} of {rows.length} · Click an item to edit it, see its versions and publish · Items that need attention are listed first.
      </p>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${selectedIds.length} ${selectedIds.length === 1 ? 'item' : 'items'} permanently?`}
        description="They're removed from browsing and AI answers for everyone, with all their versions and uploaded files. This can't be undone. Past answers that cited them keep their source snapshot."
        confirmLabel="Delete permanently"
        loading={deleting}
        onConfirm={() => {
          void deleteSelected()
        }}
      />
    </div>
  )
}

// Which version people see, and whether a newer one is waiting — in words.
function VersionLine({ row }: { row: ContentRow }) {
  const { state, live, draft } = row
  const date = live?.published_at ? formatDayMonthYear(live.published_at) : null
  if (state === 'archived') {
    return (
      <p className="text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#cfcbc2]" /> Archived
        </span>
        {live && <span className="text-gray-400"> · was v{live.version_number}</span>}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      {live ? (
        <span className="inline-flex items-center gap-1.5 text-gray-800">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-semibold">Live v{live.version_number}</span>
          {date && <span className="text-gray-400">· {date}</span>}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-gray-500">
          <span className="h-2 w-2 rounded-full border border-dashed border-gray-400" /> Not live yet
        </span>
      )}
      {draft && (
        <span
          className={`inline-flex items-center gap-1.5 ${
            state === 'needs_attention' ? 'text-red-700' : state === 'processing' ? 'text-amber-700' : 'text-sky-700'
          }`}
        >
          <span className="w-2 text-center text-[10px] leading-none">{live ? '→' : '•'}</span>
          <span className="font-semibold">Draft v{draft.version_number}</span>
          <span className="text-gray-400">
            · {state === 'needs_attention' ? 'file needs attention' : state === 'processing' ? 'reading file…' : 'ready to publish'}
          </span>
        </span>
      )}
    </div>
  )
}

// Edit, View and Close just open or close the row, so they show the
// expand arrow inside the button; every other action does its own thing.
function rowActionToggles(row: ContentRow, open: boolean, canEdit: boolean): boolean {
  if (open || !canEdit) return true
  if (row.state === 'needs_attention' || row.state === 'processing' || row.state === 'archived') return false
  return !(row.draft && (row.state === 'draft' || row.state === 'published_with_draft'))
}

function ToggleChevron({ open }: { open: boolean }) {
  return <ChevronDown size={13} className={`-mr-0.5 ml-0.5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
}

// Every row has one clear action, matching its state: Publish when a ready
// draft is waiting, Fix file when its file needs attention, Unarchive when
// archived, otherwise Edit (View when read-only) — and Close while open.
function RowAction({
  row,
  open,
  canEdit,
  busy,
  progress,
  onPublish,
  onOpen,
  onUnarchive,
}: {
  row: ContentRow
  open: boolean
  canEdit: boolean
  busy: boolean
  progress: string | null
  onPublish: () => void
  onOpen: () => void
  onUnarchive: () => void
}) {
  const outline =
    'inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors touch:py-2.5 hover:border-gray-400 hover:text-black disabled:opacity-60'
  if (open) {
    return (
      <button type="button" onClick={onOpen} aria-expanded className={outline}>
        <X size={12} /> Close <ToggleChevron open />
      </button>
    )
  }
  if (!canEdit) {
    return (
      <button type="button" onClick={onOpen} aria-expanded={false} className={outline}>
        <Eye size={12} /> View <ToggleChevron open={false} />
      </button>
    )
  }
  if (row.state === 'needs_attention') {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors touch:py-2.5 hover:border-red-300 hover:bg-red-50"
      >
        <Upload size={12} /> Fix file
      </button>
    )
  }
  if (row.state === 'processing') {
    return (
      <span className="inline-flex items-center gap-1.5 px-1 py-1.5 text-xs font-medium text-amber-700">
        <Loader2 size={12} className="animate-spin" /> Reading file…
      </span>
    )
  }
  if (row.state === 'archived') {
    return (
      <button type="button" onClick={onUnarchive} disabled={busy} className={outline}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : <ArchiveRestore size={12} />} Unarchive
      </button>
    )
  }
  if (row.draft && (row.state === 'draft' || row.state === 'published_with_draft')) {
    return (
      <button
        type="button"
        onClick={onPublish}
        disabled={busy}
        title={busy && progress ? progress : `Make v${row.draft.version_number} live for everyone`}
        className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors touch:py-2.5 hover:bg-gray-900 disabled:opacity-70"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : null}
        {busy ? (progress?.startsWith('Indexing') ? progress.replace('Indexing… ', '') : 'Publishing…') : `Publish v${row.draft.version_number}`}
      </button>
    )
  }
  return (
    <button type="button" onClick={onOpen} aria-expanded={false} className={outline}>
      <Pencil size={12} /> Edit <ToggleChevron open={false} />
    </button>
  )
}
