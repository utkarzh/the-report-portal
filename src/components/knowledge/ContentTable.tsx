import Link from 'next/link'
import { AlertTriangle, Sparkles } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import ItemTypeIcon from '@/components/knowledge/ItemTypeIcon'
import RetryExtractionButton from '@/components/knowledge/RetryExtractionButton'
import { DISPLAY_STATE_META, ITEM_TYPE_LABELS } from '@/lib/knowledge/constants'
import { formatDayMonthYear } from '@/lib/date-format'
import type { ContentRow } from '@/lib/knowledge/manage-data'

// US-119: every item in a department in one table — title, topic, type,
// status, last published, open feedback — with items needing attention
// clearly marked and sorted to the top.
export default function ContentTable({ rows, itemHref, canEdit }: { rows: ContentRow[]; itemHref: (id: string) => string; canEdit: boolean }) {
  const sorted = [...rows].sort((a, b) => {
    const rank = (r: ContentRow) => (r.state === 'needs_attention' ? 0 : r.state === 'processing' ? 1 : 2)
    return rank(a) - rank(b)
  })
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#e5e3df] bg-white p-10 text-center text-sm text-gray-500">
        No items here yet.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[#e5e3df] bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-[#e5e3df] text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Topic</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Last published</th>
            <th className="px-4 py-3 text-right">Open feedback</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0efec]">
          {sorted.map((r) => {
            const meta = DISPLAY_STATE_META[r.state]
            const attention = r.state === 'needs_attention'
            return (
              <tr key={r.item.id} className={attention ? 'bg-red-50/40' : 'hover:bg-gray-50'}>
                <td className="px-4 py-3">
                  <Link href={itemHref(r.item.id)} className="font-medium text-gray-900 hover:underline">
                    {r.item.title}
                  </Link>
                  {r.item.is_example && <Sparkles size={12} className="ml-1.5 inline text-[#a07530]" aria-label="Example of excellent work" />}
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
                </td>
                <td className="px-4 py-3 text-gray-600">{r.topicName ?? <span className="italic text-gray-400">Unsorted</span>}</td>
                <td className="px-4 py-3 text-gray-600">
                  <span className="inline-flex items-center gap-1.5"><ItemTypeIcon type={r.item.type} size={13} /> {ITEM_TYPE_LABELS[r.item.type]}</span>
                </td>
                <td className="px-4 py-3"><StatusPill label={meta.label} tone={meta.tone} pulse={r.state === 'processing' && !r.stalled} /></td>
                <td className="px-4 py-3 text-gray-600">{r.item.last_published_at ? formatDayMonthYear(r.item.last_published_at) : '—'}</td>
                <td className="px-4 py-3 text-right">
                  {r.openFeedback > 0 ? (
                    <span className="inline-flex min-w-6 justify-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{r.openFeedback}</span>
                  ) : (
                    <span className="text-gray-300">0</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
