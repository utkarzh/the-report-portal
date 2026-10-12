export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ChevronRight, MessagesSquare, SearchX, ShieldCheck } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireKbAdmin } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { RATING_LABELS, FEEDBACK_STATUS_LABELS, stripCitations } from '@/lib/knowledge/constants'
import { renderAnswerHtml } from '@/lib/knowledge/markdown'
import { formatCost } from '@/lib/claude/tokens'
import { formatDayMonthYearTime } from '@/lib/date-format'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import KnowledgeAdminNav from '@/components/knowledge/admin/KnowledgeAdminNav'
import { Avatar, EmptyState } from '@/components/knowledge/kb-ui'
import type { KnowledgeFeedback, KnowledgeMessage } from '@/types'

const PAGE_SIZE = 20

// One-line plain-text preview of an answer for the collapsed row.
function preview(md: string): string {
  const t = stripCitations(md).replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim()
  return t.length > 120 ? `${t.slice(0, 120)}…` : t
}
const OUTCOMES = [
  { key: '', label: 'All answers' },
  { key: 'answered', label: 'Answered' },
  { key: 'no_answer', label: 'No approved answer' },
]

// US-118: every user's questions and answers, with sources and the feedback
// given on each answer. Filter by user, department, outcome and date.
export default async function KnowledgeAdminChatsPage({
  searchParams,
}: {
  searchParams: { user?: string; department?: string; from?: string; to?: string; outcome?: string; page?: string }
}) {
  await requireKbAdmin()
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const userFilter = searchParams.user || ''
  const deptFilter = searchParams.department || ''
  const outcome = searchParams.outcome === 'answered' || searchParams.outcome === 'no_answer' ? searchParams.outcome : ''
  const from = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.from || '') ? searchParams.from! : ''
  const to = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.to || '') ? searchParams.to! : ''

  const [{ data: departments }, { data: chatOwners }] = await Promise.all([
    supabaseAdmin.from('knowledge_departments').select('id, name').order('name'),
    supabaseAdmin.from('knowledge_chats').select('user_id'),
  ])
  const ownerIds = Array.from(new Set((chatOwners || []).map((c) => c.user_id).filter(Boolean))) as string[]
  const { data: owners } = ownerIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', ownerIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] }
  const ownerName = new Map((owners || []).map((o) => [o.id, displayName(o)]))

  let chatIdsForUser: string[] | null = null
  if (userFilter) {
    const { data } = await supabaseAdmin.from('knowledge_chats').select('id').eq('user_id', userFilter)
    chatIdsForUser = (data || []).map((c) => c.id)
  }

  let rows: KnowledgeMessage[] = []
  let total = 0
  if (chatIdsForUser === null || chatIdsForUser.length > 0) {
    let q = supabaseAdmin
      .from('knowledge_messages')
      .select('*', { count: 'exact' })
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
    if (chatIdsForUser) q = q.in('chat_id', chatIdsForUser)
    if (deptFilter) q = q.contains('department_ids', [deptFilter])
    if (outcome) q = q.eq('no_answer', outcome === 'no_answer')
    if (from) q = q.gte('created_at', `${from}T00:00:00Z`)
    if (to) q = q.lte('created_at', `${to}T23:59:59Z`)
    const { data, count } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    rows = (data || []) as KnowledgeMessage[]
    total = count ?? 0
  }

  const chatIds = Array.from(new Set(rows.map((r) => r.chat_id)))
  const answerIds = rows.map((r) => r.id)
  const [{ data: chats }, { data: userMsgs }, { data: fb }] = await Promise.all([
    chatIds.length ? supabaseAdmin.from('knowledge_chats').select('id, user_id').in('id', chatIds) : Promise.resolve({ data: [] as { id: string; user_id: string | null }[] }),
    chatIds.length
      ? supabaseAdmin.from('knowledge_messages').select('chat_id, content, created_at').in('chat_id', chatIds).eq('role', 'user').order('created_at')
      : Promise.resolve({ data: [] as { chat_id: string; content: string; created_at: string }[] }),
    answerIds.length ? supabaseAdmin.from('knowledge_feedback').select('*').in('message_id', answerIds) : Promise.resolve({ data: [] as KnowledgeFeedback[] }),
  ])
  const chatUser = new Map((chats || []).map((c) => [c.id, c.user_id]))
  const deptName = new Map((departments || []).map((d) => [d.id, d.name]))
  const questionFor = (a: KnowledgeMessage) => {
    const prior = (userMsgs || []).filter((u) => u.chat_id === a.chat_id && u.created_at <= a.created_at)
    return prior.length ? prior[prior.length - 1].content : '—'
  }
  const feedbackFor = (id: string) => ((fb || []) as KnowledgeFeedback[]).filter((f) => f.message_id === id)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const qs = new URLSearchParams()
  if (userFilter) qs.set('user', userFilter)
  if (deptFilter) qs.set('department', deptFilter)
  if (outcome) qs.set('outcome', outcome)
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const pageHref = (p: number) => `/knowledge/admin/chats?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(p) })}`
  const selectCls =
    'min-w-[170px] rounded-lg border border-[#e5e3df] bg-white px-2.5 py-2 text-sm font-normal normal-case tracking-normal text-gray-900 focus:border-black focus:outline-none'

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <Breadcrumbs items={[{ label: 'Knowledge Base', href: '/knowledge' }, { label: 'Admin', href: '/knowledge/admin' }, { label: 'Chat log' }]} />

        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">Knowledge Base — Admin</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">Every question and answer, with the sources used and any feedback given — for quality control.</p>
        </div>

        <KnowledgeAdminNav active="chats" />

        <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#e5e3df] bg-white p-4 shadow-sm">
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Person
            <select name="user" defaultValue={userFilter} className={selectCls}>
              <option value="">Everyone</option>
              {(owners || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {displayName(o)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Department
            <select name="department" defaultValue={deptFilter} className={selectCls}>
              <option value="">All departments</option>
              {(departments || []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Outcome
            <select name="outcome" defaultValue={outcome} className={selectCls}>
              {OUTCOMES.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            From
            <input type="date" name="from" defaultValue={from} className="rounded-lg border border-[#e5e3df] bg-white px-2.5 py-1.5 text-sm font-normal text-gray-900 focus:border-black focus:outline-none" />
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            To
            <input type="date" name="to" defaultValue={to} className="rounded-lg border border-[#e5e3df] bg-white px-2.5 py-1.5 text-sm font-normal text-gray-900 focus:border-black focus:outline-none" />
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900">
              Apply
            </button>
            {qs.toString() && (
              <Link href="/knowledge/admin/chats" className="text-xs font-medium text-gray-500 hover:text-black">
                Clear filters
              </Link>
            )}
          </div>
        </form>

        <p className="mb-3 mt-5 text-xs text-gray-500">
          {total.toLocaleString('en-US')} answer{total === 1 ? '' : 's'}
          {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''} · times in UTC
        </p>

        <div className="flex flex-col gap-4">
          {rows.length === 0 && (
            <EmptyState icon={MessagesSquare} title="No questions match these filters">
              Try a wider date range or clear the filters.
            </EmptyState>
          )}
          {rows.map((a) => {
            const uid = chatUser.get(a.chat_id)
            const who = uid ? ownerName.get(uid) ?? 'Unknown user' : 'Deleted user'
            const feedback = feedbackFor(a.id)
            const cited = a.sources.filter((s) => s.cited).length
            return (
              <article key={a.id} className="overflow-hidden rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eceae5] bg-[#fcfbf9] px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={who} size="sm" />
                    <span className="text-[13px] font-medium text-gray-900">{who}</span>
                    <span className="text-[11px] text-gray-400">{formatDayMonthYearTime(a.created_at)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    {a.no_answer ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                        <SearchX size={10} /> No approved answer
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                        <ShieldCheck size={10} /> {cited} source{cited === 1 ? '' : 's'} cited
                      </span>
                    )}
                    <span className="tabular-nums">{formatCost(Number(a.cost_usd || 0))}</span>
                  </div>
                </div>
                <div className="p-5">
                  <p className="flex items-start gap-2 text-sm font-medium leading-6 text-gray-900">
                    <span className="mt-1 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-black text-[9px] font-semibold text-white">Q</span>
                    {questionFor(a)}
                  </p>
                  {a.department_ids.length > 0 && (
                    <p className="mt-1 pl-6 text-[11px] text-gray-400">Searched {a.department_ids.map((d) => deptName.get(d) ?? 'a deleted department').join(', ')}</p>
                  )}
                  <details className="group mt-3 rounded-xl border border-[#eceae5]">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-gray-600 hover:text-gray-900">
                      <ChevronRight size={12} className="transition-transform group-open:rotate-90" /> Answer
                      <span className="ml-1 truncate font-normal text-gray-400 group-open:hidden">— {preview(a.content)}</span>
                    </summary>
                    <div className="prose-research max-h-96 overflow-y-auto border-t border-[#eceae5] px-4 py-3 text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: renderAnswerHtml(a.content) }} />
                  </details>
                  {a.sources.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {a.sources.map((s) => (
                        <li
                          key={s.ref}
                          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                            s.cited ? 'border-[#e5e3df] bg-white text-gray-700' : 'border-dashed border-[#e5e3df] text-gray-400'
                          }`}
                        >
                          <span className="font-semibold">{s.ref}</span>
                          <span className="truncate">{s.title}</span>
                          <span className="text-gray-400">· {s.department_name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {feedback.length > 0 && (
                    <div className="mt-4 flex flex-col gap-1.5 border-t border-[#f0efec] pt-3">
                      {feedback.map((f) => (
                        <p key={f.id} className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              f.rating === 'helpful' ? 'bg-emerald-50 text-emerald-700' : f.kind === 'suggestion' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {f.kind === 'suggestion' ? 'Suggestion' : f.rating ? RATING_LABELS[f.rating] : 'Feedback'}
                          </span>
                          {f.comment && <span className="text-gray-700">“{f.comment}”</span>}
                          <span className="text-gray-400">· {FEEDBACK_STATUS_LABELS[f.status].toLowerCase()}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between text-xs">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 font-medium text-gray-700 hover:border-gray-400">
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-gray-500">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 font-medium text-gray-700 hover:border-gray-400">
                Older →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
