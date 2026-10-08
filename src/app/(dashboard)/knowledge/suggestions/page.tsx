export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Paperclip, ExternalLink } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { FEEDBACK_STATUS_LABELS, RATING_LABELS } from '@/lib/knowledge/constants'
import { formatDayMonthYear } from '@/lib/date-format'
import KnowledgeNav from '@/components/knowledge/KnowledgeNav'
import StatusPill from '@/components/ui/StatusPill'
import type { KnowledgeFeedback } from '@/types'

const TONE = { open: 'amber', accepted: 'emerald', declined: 'stone', done: 'sky' } as const

// US-116: the user follows what happened to their suggestions (and the
// feedback they flagged): open, accepted, declined or done, with the
// Guardian's note.
export default async function KnowledgeSuggestionsPage() {
  const ctx = await getKbPageContext()
  // Suggestions, plus feedback that went to a Guardian ("Helpful" never does).
  const { data } = await supabaseAdmin
    .from('knowledge_feedback')
    .select('*')
    .eq('user_id', ctx.actor.id)
    .or('kind.eq.suggestion,rating.neq.helpful')
    .order('created_at', { ascending: false })
    .limit(200)
  const rows = (data || []) as KnowledgeFeedback[]

  const deptIds = Array.from(new Set(rows.map((r) => r.department_id).filter(Boolean))) as string[]
  const itemIds = Array.from(new Set(rows.map((r) => r.item_id).filter(Boolean))) as string[]
  const [{ data: depts }, { data: items }] = await Promise.all([
    deptIds.length ? supabaseAdmin.from('knowledge_departments').select('id, name').in('id', deptIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    itemIds.length ? supabaseAdmin.from('knowledge_items').select('id, title').in('id', itemIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ])
  const deptName = new Map((depts || []).map((d) => [d.id, d.name]))
  const itemTitle = new Map((items || []).map((i) => [i.id, i.title]))

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <KnowledgeNav active="suggestions" showManage={ctx.showManage} />
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e5e3df] bg-white p-10 text-center text-sm text-gray-500">
            You haven’t sent any suggestions or feedback yet. Use “Suggest a change” on an answer or an item, or the feedback buttons under an answer.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-[#e5e3df] bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-widest text-gray-400">
                      {r.kind === 'suggestion'
                        ? r.suggestion_type === 'new'
                          ? 'New knowledge suggestion'
                          : 'Change suggestion'
                        : `Feedback · ${r.rating ? RATING_LABELS[r.rating] : ''}`}
                      {r.department_id && deptName.get(r.department_id) ? ` · ${deptName.get(r.department_id)}` : ''}
                    </p>
                    {r.item_id && itemTitle.get(r.item_id) && (
                      <p className="mt-1 text-xs text-gray-500">
                        About{' '}
                        <Link href={`/knowledge/items/${r.item_id}`} className="font-medium text-gray-700 hover:underline">
                          {itemTitle.get(r.item_id)}
                        </Link>
                      </p>
                    )}
                    {r.comment && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{r.comment}</p>}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {r.link_url && (
                        <a href={r.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gray-600 hover:text-black">
                          <ExternalLink size={12} /> Link
                        </a>
                      )}
                      {r.attachment_path && (
                        <a href={`/api/knowledge/feedback/${r.id}/attachment`} className="inline-flex items-center gap-1 text-gray-600 hover:text-black">
                          <Paperclip size={12} /> {r.attachment_name}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusPill label={FEEDBACK_STATUS_LABELS[r.status]} tone={TONE[r.status]} />
                    <span className="text-[11px] text-gray-400">{formatDayMonthYear(r.created_at)}</span>
                  </div>
                </div>
                {r.guardian_note && (
                  <p className="mt-3 rounded-lg bg-[#faf9f7] px-3 py-2 text-xs text-gray-600">
                    <span className="font-medium text-gray-800">Guardian’s note:</span> {r.guardian_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
