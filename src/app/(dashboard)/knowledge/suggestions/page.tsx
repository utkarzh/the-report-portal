export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { CheckCircle2, CircleDot, ExternalLink, FilePlus2, Inbox, Lightbulb, MessageSquareWarning, Paperclip, XCircle } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { FEEDBACK_STATUS_LABELS, RATING_LABELS } from '@/lib/knowledge/constants'
import { timeAgo } from '@/lib/knowledge/format'
import { formatDayMonthYear } from '@/lib/date-format'
import KnowledgeHeader from '@/components/knowledge/KnowledgeHeader'
import { EmptyState, FilterChips, StatTile } from '@/components/knowledge/kb-ui'
import StatusPill from '@/components/ui/StatusPill'
import type { KnowledgeFeedback, KnowledgeFeedbackStatus } from '@/types'

const TONE = { open: 'amber', accepted: 'emerald', declined: 'stone', done: 'sky' } as const
const ACCENT: Record<KnowledgeFeedbackStatus, string> = {
  open: 'bg-amber-400',
  accepted: 'bg-emerald-500',
  declined: 'bg-stone-300',
  done: 'bg-sky-400',
}
const STATUSES: KnowledgeFeedbackStatus[] = ['open', 'accepted', 'declined', 'done']

function kindLabel(r: KnowledgeFeedback): { label: string; icon: React.ElementType } {
  if (r.kind === 'suggestion') {
    return r.suggestion_type === 'new' ? { label: 'Suggested new knowledge', icon: FilePlus2 } : { label: 'Suggested a change', icon: Lightbulb }
  }
  return { label: `Reported an answer as “${r.rating ? RATING_LABELS[r.rating] : 'Feedback'}”`, icon: MessageSquareWarning }
}

// US-116: the user follows what happened to their suggestions (and the
// feedback they flagged): open, accepted, declined or done, with the
// Guardian's note.
export default async function KnowledgeSuggestionsPage({ searchParams }: { searchParams: { status?: string } }) {
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
  const status = STATUSES.includes(searchParams.status as KnowledgeFeedbackStatus) ? (searchParams.status as KnowledgeFeedbackStatus) : null
  const shown = status ? rows.filter((r) => r.status === status) : rows
  const count = (s: KnowledgeFeedbackStatus) => rows.filter((r) => r.status === s).length

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
        <KnowledgeHeader ctx={ctx} active="suggestions" />

        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="You haven’t sent anything to a Guardian yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/knowledge" className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-900">
                  Ask a question
                </Link>
                <Link href="/knowledge/browse" className="inline-flex items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:border-gray-400">
                  Browse knowledge
                </Link>
              </div>
            }
          >
            When an answer is unclear, wrong or out of date — or something is missing — flag it from the answer or use “Suggest a change” on any item. You’ll see here what the Guardian decided.
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Waiting for review" value={count('open')} icon={CircleDot} tone={count('open') ? 'amber' : 'default'} href="/knowledge/suggestions?status=open" />
              <StatTile label="Accepted" value={count('accepted')} icon={CheckCircle2} tone={count('accepted') ? 'emerald' : 'default'} href="/knowledge/suggestions?status=accepted" />
              <StatTile label="Declined" value={count('declined')} icon={XCircle} href="/knowledge/suggestions?status=declined" />
              <StatTile label="Done" value={count('done')} icon={CheckCircle2} href="/knowledge/suggestions?status=done" />
            </div>

            <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3">
              <FilterChips
                active={status ?? 'all'}
                options={[
                  { key: 'all', label: 'All', href: '/knowledge/suggestions', count: rows.length },
                  ...STATUSES.map((s) => ({ key: s, label: FEEDBACK_STATUS_LABELS[s], href: `/knowledge/suggestions?status=${s}`, count: count(s) })),
                ]}
              />
              <p className="text-[11px] text-gray-400">Guardians review every report before anything changes.</p>
            </div>

            {shown.length === 0 ? (
              <EmptyState icon={Inbox} title={`Nothing ${status ? FEEDBACK_STATUS_LABELS[status].toLowerCase() : ''} right now`} />
            ) : (
              <ul className="flex flex-col gap-3">
                {shown.map((r) => {
                  const { label, icon: Icon } = kindLabel(r)
                  return (
                    <li key={r.id} className="relative overflow-hidden rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
                      <span className={`absolute inset-y-0 left-0 w-1 ${ACCENT[r.status]}`} />
                      <div className="p-5 pl-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#f7f6f3] text-gray-600">
                              <Icon size={15} />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900">{label}</p>
                              <p className="mt-0.5 text-[11px] text-gray-500">
                                {r.department_id && deptName.get(r.department_id) ? `${deptName.get(r.department_id)} · ` : ''}
                                <span title={formatDayMonthYear(r.created_at)}>Sent {timeAgo(r.created_at)}</span>
                                {r.item_id && itemTitle.get(r.item_id) && (
                                  <>
                                    {' · About '}
                                    <Link href={`/knowledge/items/${r.item_id}`} className="font-medium text-gray-700 hover:underline">
                                      {itemTitle.get(r.item_id)}
                                    </Link>
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                          <StatusPill label={FEEDBACK_STATUS_LABELS[r.status]} tone={TONE[r.status]} />
                        </div>

                        {r.comment && (
                          <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-[#e5e3df] pl-3 text-sm leading-6 text-gray-700">{r.comment}</blockquote>
                        )}
                        {(r.link_url || r.attachment_path) && (
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            {r.link_url && (
                              <a href={r.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#e5e3df] px-2.5 py-1 text-gray-600 hover:border-gray-400 hover:text-black">
                                <ExternalLink size={12} /> <span className="truncate">{r.link_url}</span>
                              </a>
                            )}
                            {r.attachment_path && (
                              <a href={`/api/knowledge/feedback/${r.id}/attachment`} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] px-2.5 py-1 text-gray-600 hover:border-gray-400 hover:text-black">
                                <Paperclip size={12} /> {r.attachment_name}
                              </a>
                            )}
                          </div>
                        )}

                        {r.guardian_note ? (
                          <div className="mt-4 rounded-xl bg-[#faf9f7] px-4 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                              Guardian’s reply{r.resolved_at ? ` · ${formatDayMonthYear(r.resolved_at)}` : ''}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-700">{r.guardian_note}</p>
                          </div>
                        ) : r.status !== 'open' && r.resolved_at ? (
                          <p className="mt-3 text-[11px] text-gray-400">
                            {FEEDBACK_STATUS_LABELS[r.status]} on {formatDayMonthYear(r.resolved_at)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
