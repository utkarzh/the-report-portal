export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, SearchX } from 'lucide-react'
import { redirect } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { knowledgeBaseInstalled } from '@/lib/knowledge/installed'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { displayName } from '@/lib/knowledge/access'
import { RATING_LABELS, FEEDBACK_STATUS_LABELS } from '@/lib/knowledge/constants'
import { renderAnswerHtml } from '@/lib/knowledge/markdown'
import { formatCost } from '@/lib/claude/tokens'
import { formatDayMonthYear } from '@/lib/date-format'
import type { KnowledgeFeedback, KnowledgeMessage } from '@/types'

const PAGE_SIZE = 20

function timeOf(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

// US-118: every user's questions and answers, with sources and the feedback
// given on each answer. Filter by user, department and date.
export default async function AdminKnowledgeChatsPage({
  searchParams,
}: {
  searchParams: { user?: string; department?: string; from?: string; to?: string; page?: string }
}) {
  requireAdminHeader()
  if (!(await knowledgeBaseInstalled())) redirect('/knowledge/setup')
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const userFilter = searchParams.user || ''
  const deptFilter = searchParams.department || ''
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
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <Link href="/admin/knowledge" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black">
          <ArrowLeft size={13} /> Knowledge Base
        </Link>
        <h1 className="mt-3 text-lg font-semibold text-gray-900">Knowledge Base chat log</h1>
        <p className="mt-1.5 text-sm text-gray-500">Every question and answer, with the sources used and any feedback given.</p>

        <form method="get" className="mt-6 flex flex-wrap items-end gap-4 rounded-xl border border-[#e5e3df] bg-white p-4">
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            User
            <select name="user" defaultValue={userFilter} className="min-w-[180px] border-b border-gray-300 bg-transparent py-1.5 text-sm font-normal normal-case tracking-normal text-gray-900 focus:outline-none">
              <option value="">All users</option>
              {(owners || []).map((o) => <option key={o.id} value={o.id}>{displayName(o)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Department
            <select name="department" defaultValue={deptFilter} className="min-w-[180px] border-b border-gray-300 bg-transparent py-1.5 text-sm font-normal normal-case tracking-normal text-gray-900 focus:outline-none">
              <option value="">All departments</option>
              {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            From
            <input type="date" name="from" defaultValue={from} className="border-b border-gray-300 bg-transparent py-1.5 text-sm font-normal text-gray-900 focus:outline-none" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            To
            <input type="date" name="to" defaultValue={to} className="border-b border-gray-300 bg-transparent py-1.5 text-sm font-normal text-gray-900 focus:outline-none" />
          </label>
          <button type="submit" className="bg-black px-4 py-2 text-xs font-medium uppercase tracking-wider text-white hover:bg-gray-900">Filter</button>
          {qs.toString() && <Link href="/admin/knowledge/chats" className="text-xs text-gray-500 hover:text-black">Clear</Link>}
        </form>

        <p className="mt-4 text-xs text-gray-500">{total} answer{total === 1 ? '' : 's'}</p>

        <div className="mt-3 flex flex-col gap-4">
          {rows.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#e5e3df] bg-white p-10 text-center text-sm text-gray-500">No questions match these filters.</div>
          )}
          {rows.map((a) => {
            const uid = chatUser.get(a.chat_id)
            const feedback = feedbackFor(a.id)
            return (
              <article key={a.id} className="rounded-xl border border-[#e5e3df] bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
                  <span>
                    <span className="font-medium text-gray-800">{uid ? ownerName.get(uid) ?? 'Unknown user' : 'Deleted user'}</span>
                    {' · '}
                    {formatDayMonthYear(a.created_at)} {timeOf(a.created_at)}
                    {a.department_ids.length > 0 && ` · searched ${a.department_ids.map((d) => deptName.get(d) ?? '?').join(', ')}`}
                  </span>
                  <span>{formatCost(Number(a.cost_usd || 0))}</span>
                </div>
                <p className="mt-3 text-sm font-medium text-gray-900">{questionFor(a)}</p>
                {a.no_answer && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    <SearchX size={12} /> No approved answer
                  </p>
                )}
                <div className="prose-research mt-2 max-h-72 overflow-y-auto text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: renderAnswerHtml(a.content) }} />
                {a.sources.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {a.sources.map((s) => (
                      <li key={s.ref} className={`rounded-full border px-2.5 py-1 text-[11px] ${s.cited ? 'border-[#e5e3df] text-gray-700' : 'border-dashed border-[#e5e3df] text-gray-400'}`}>
                        <span className="font-semibold">{s.ref}</span> {s.title} · {s.department_name}
                      </li>
                    ))}
                  </ul>
                )}
                {feedback.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1.5 border-t border-[#f0efec] pt-3">
                    {feedback.map((f) => (
                      <p key={f.id} className="text-xs text-gray-600">
                        <span className="font-medium text-gray-800">
                          {f.kind === 'suggestion' ? 'Suggestion' : f.rating ? RATING_LABELS[f.rating] : 'Feedback'}
                        </span>
                        {f.comment ? ` — “${f.comment}”` : ''}
                        <span className="ml-1.5 text-gray-400">({FEEDBACK_STATUS_LABELS[f.status].toLowerCase()})</span>
                      </p>
                    ))}
                  </div>
                )}
              </article>
            )
          })}
        </div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between text-xs">
            {page > 1 ? (
              <Link href={`/admin/knowledge/chats?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page - 1) })}`} className="font-medium text-gray-700 hover:text-black">← Newer</Link>
            ) : <span />}
            <span className="text-gray-500">Page {page} of {totalPages}</span>
            {page < totalPages ? (
              <Link href={`/admin/knowledge/chats?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page + 1) })}`} className="font-medium text-gray-700 hover:text-black">Older →</Link>
            ) : <span />}
          </div>
        )}
      </div>
    </div>
  )
}
