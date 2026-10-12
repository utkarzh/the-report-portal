'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronRight, FolderOpen, MessageSquareWarning, Search } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import RetryExtractionButton from '@/components/knowledge/RetryExtractionButton'
import { ExampleBadge, TypeTile } from '@/components/knowledge/kb-ui'
import { DISPLAY_STATE_META, ITEM_TYPE_LABELS, type ItemDisplayState } from '@/lib/knowledge/constants'
import { formatDayMonthYear } from '@/lib/date-format'
import type { ContentRow } from '@/lib/knowledge/manage-data'

type StatusFilter = 'all' | 'published' | 'drafts' | 'attention' | 'archived'

const FILTERS: { key: StatusFilter; label: string; match: (s: ItemDisplayState) => boolean }[] = [
  { key: 'all', label: 'All', match: (s) => s !== 'archived' },
  { key: 'published', label: 'Published', match: (s) => s === 'published' || s === 'published_with_draft' },
  // Every item with a pending draft — including one whose file needs attention.
  { key: 'drafts', label: 'Drafts', match: (s) => s === 'draft' || s === 'published_with_draft' || s === 'processing' || s === 'needs_attention' },
  { key: 'attention', label: 'Needs attention', match: (s) => s === 'needs_attention' },
  { key: 'archived', label: 'Archived', match: (s) => s === 'archived' },
]

// US-119: every item in a department in one table — title, topic, type,
// status, last published, open feedback — with items needing attention
// clearly marked and sorted to the top. Search and status filters run in the
// browser over the rows the page already loaded.
export default function ContentTable({ rows, itemHrefBase, canEdit }: { rows: ContentRow[]; itemHrefBase: string; canEdit: boolean }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => f.match(r.state)).length])) as Record<StatusFilter, number>, [rows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = FILTERS.find((f) => f.key === filter)!.match
    const rank = (r: ContentRow) => (r.state === 'needs_attention' ? 0 : r.state === 'processing' ? 1 : 2)
    return rows
      .filter((r) => match(r.state))
      .filter((r) => !q || r.item.title.toLowerCase().includes(q) || (r.topicName ?? '').toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b))
  }, [rows, query, filter])

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#d9d5cc] bg-white/60 px-6 py-14 text-center">
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
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
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

      <div className="overflow-x-auto rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-[#e5e3df] bg-[#fcfbf9] text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              <th className="w-[44%] px-4 py-3">Item</th>
              <th className="px-4 py-3">Topic</th>
              <th className="px-4 py-3">Status</th>
              <th className="whitespace-nowrap px-4 py-3">Last published</th>
              <th className="px-4 py-3 text-right">Feedback</th>
              <th className="w-8 px-2 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0efec]">
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-gray-400">
                  No items match.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const meta = DISPLAY_STATE_META[r.state]
              const attention = r.state === 'needs_attention'
              const href = `${itemHrefBase}/${r.item.id}`
              return (
                <tr
                  key={r.item.id}
                  onClick={() => router.push(href)}
                  className={`group cursor-pointer transition-colors ${attention ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-[#faf9f7]'}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <TypeTile type={r.item.type} size="sm" example={r.item.is_example} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={href} onClick={(e) => e.stopPropagation()} className="font-medium text-gray-900 hover:underline">
                            {r.item.title}
                          </Link>
                          {r.item.is_example && <ExampleBadge compact />}
                        </div>
                        <p className="mt-0.5 text-[11px] text-gray-400">{ITEM_TYPE_LABELS[r.item.type]}</p>
                        {attention && r.draft?.extraction_error && (
                          <p className="mt-1 flex items-start gap-1 text-[11px] text-red-700">
                            <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /> {r.draft.extraction_error}
                          </p>
                        )}
                        {r.state === 'processing' && r.stalled && canEdit && r.draft && (
                          <p className="mt-1 flex items-center gap-2 text-[11px] text-amber-700">
                            Processing stopped. <RetryExtractionButton versionId={r.draft.id} />
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.topicName ?? <span className="italic text-gray-400">Unsorted</span>}</td>
                  <td className="px-4 py-3">
                    <StatusPill label={meta.label} tone={meta.tone} pulse={r.state === 'processing' && !r.stalled} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{r.item.last_published_at ? formatDayMonthYear(r.item.last_published_at) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-right">
                    {r.openFeedback > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <MessageSquareWarning size={11} /> {r.openFeedback}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <ChevronRight size={15} className="text-gray-300 transition-colors group-hover:text-gray-500" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Showing {visible.length} of {rows.length} · Items that need attention are listed first.
      </p>
    </div>
  )
}
