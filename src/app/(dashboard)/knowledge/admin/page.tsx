export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { AlertTriangle, ChevronRight, FolderKanban, Inbox, Layers, MessageCircleQuestion, SearchX, UsersRound } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireKbAdmin } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { guardianWarningFor, loadUserOptions } from '@/lib/knowledge/admin-data'
import { timeAgo } from '@/lib/knowledge/format'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import KnowledgeAdminNav from '@/components/knowledge/admin/KnowledgeAdminNav'
import DepartmentFormModal from '@/components/knowledge/admin/DepartmentFormModal'
import { Avatar, DeptMonogram, EmptyState, SectionHeader, StatTile } from '@/components/knowledge/kb-ui'
import type { KnowledgeDepartment } from '@/types'

const DAY_MS = 86_400_000

// Knowledge Base → Admin: departments, Guardians, members (US-098, US-099,
// US-122), with the chat log one tab away (US-118). Lives inside the module
// (like every other module's admin area), so it guards itself.
export default async function KnowledgeAdminPage() {
  await requireKbAdmin()
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString()

  const [{ data: depts }, { data: members }, { data: items }, { data: feedback }, users, { count: questions30 }, { count: noAnswer30 }] = await Promise.all([
    supabaseAdmin.from('knowledge_departments').select('*').order('archived_at', { nullsFirst: true }).order('name'),
    supabaseAdmin.from('knowledge_department_members').select('department_id, user_id'),
    supabaseAdmin.from('knowledge_items').select('department_id, status, draft_version_id, last_published_at'),
    supabaseAdmin.from('knowledge_feedback').select('department_id').eq('status', 'open'),
    loadUserOptions(),
    supabaseAdmin.from('knowledge_messages').select('id', { count: 'exact', head: true }).eq('role', 'assistant').gte('created_at', since),
    supabaseAdmin.from('knowledge_messages').select('id', { count: 'exact', head: true }).eq('role', 'assistant').eq('no_answer', true).gte('created_at', since),
  ])
  const departments = (depts || []) as KnowledgeDepartment[]
  const guardianIds = Array.from(new Set(departments.map((d) => d.guardian_id).filter(Boolean))) as string[]
  const { data: guardians } = guardianIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, email, status').in('id', guardianIds)
    : { data: [] as { id: string; full_name: string | null; email: string; status: string }[] }
  const gMap = new Map((guardians || []).map((g) => [g.id, g]))
  const count = <T extends { department_id: string | null }>(rows: T[] | null, id: string, pred: (r: T) => boolean = () => true) =>
    (rows || []).filter((r) => r.department_id === id && pred(r)).length
  const lastPublished = (id: string) =>
    (items || []).reduce<string | null>((acc, i) => (i.department_id === id && i.last_published_at && (!acc || i.last_published_at > acc) ? i.last_published_at : acc), null)

  const live = departments.filter((d) => !d.archived_at)
  const liveIds = new Set(live.map((d) => d.id))
  const people = new Set<string>([
    ...(members || []).filter((m) => liveIds.has(m.department_id)).map((m) => m.user_id as string),
    ...(live.map((d) => d.guardian_id).filter(Boolean) as string[]),
  ])
  const published = (items || []).filter((i) => i.status === 'published' && liveIds.has(i.department_id)).length
  const openFeedback = (feedback || []).filter((f) => f.department_id && liveIds.has(f.department_id)).length
  const q30 = questions30 ?? 0
  const na30 = noAnswer30 ?? 0
  const warnings = live
    .map((d) => ({ d, warning: guardianWarningFor(d.guardian_id ? gMap.get(d.guardian_id) ?? null : null, !!d.guardian_id) }))
    .filter((w) => w.warning)

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <Breadcrumbs items={[{ label: 'Knowledge Base', href: '/knowledge' }, { label: 'Admin' }]} />

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Knowledge Base — Admin</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
              Create departments, give each one a Guardian and choose who belongs to it. Guardians write and publish the knowledge; members can ask and browse it.
            </p>
          </div>
          <DepartmentFormModal users={users} />
        </div>

        <KnowledgeAdminNav active="departments" />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Departments" value={live.length} icon={FolderKanban} sub={departments.length > live.length ? `${departments.length - live.length} archived` : 'All live'} />
          <StatTile label="People with access" value={people.size} icon={UsersRound} sub="Members + Guardians" />
          <StatTile label="Published items" value={published} icon={Layers} sub="Live in answers" />
          <StatTile label="Questions" value={q30} icon={MessageCircleQuestion} sub="Last 30 days" href="/knowledge/admin/chats" />
          <StatTile
            label="No approved answer"
            value={q30 ? `${Math.round((na30 / q30) * 100)}%` : '—'}
            icon={SearchX}
            tone={q30 && na30 / q30 > 0.25 ? 'amber' : 'default'}
            sub={`${na30} of ${q30} · 30 days`}
            href="/knowledge/admin/chats?outcome=no_answer"
          />
          <StatTile label="Open feedback" value={openFeedback} icon={Inbox} tone={openFeedback ? 'amber' : 'default'} sub="Waiting for Guardians" />
        </div>

        {warnings.length > 0 && (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <AlertTriangle size={15} /> {warnings.length === 1 ? 'One department needs' : `${warnings.length} departments need`} a Guardian
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {warnings.map(({ d, warning }) => (
                <li key={d.id} className="text-xs leading-5 text-amber-800">
                  <Link href={`/knowledge/admin/${d.id}`} className="font-semibold underline-offset-2 hover:underline">
                    {d.name}
                  </Link>{' '}
                  — {warning}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="mt-8">
          <SectionHeader title="Departments" count={departments.length} />
          {departments.length === 0 ? (
            <EmptyState icon={FolderKanban} title="No departments yet" action={<DepartmentFormModal users={users} label="Create the first department" />}>
              Start with the teams whose know-how people ask about most — e.g. Editorial, Business Development, Graphics — and assign each one its Guardian.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-[#e5e3df] bg-[#fcfbf9] text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    <th className="px-5 py-3">Department</th>
                    <th className="px-4 py-3">Guardian</th>
                    <th className="px-4 py-3 text-right">Members</th>
                    <th className="px-4 py-3 text-right">Published</th>
                    <th className="px-4 py-3 text-right">Drafts</th>
                    <th className="px-4 py-3 text-right">Open feedback</th>
                    <th className="px-4 py-3">Last published</th>
                    <th className="w-8 px-2 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0efec]">
                  {departments.map((d) => {
                    const g = d.guardian_id ? gMap.get(d.guardian_id) ?? null : null
                    const warning = !d.archived_at ? guardianWarningFor(g, !!d.guardian_id) : null
                    const open = count(feedback, d.id)
                    const last = lastPublished(d.id)
                    return (
                      <tr key={d.id} className={`group transition-colors ${d.archived_at ? 'bg-[#fcfbf9] text-gray-400' : 'hover:bg-[#faf9f7]'}`}>
                        <td className="px-5 py-3.5">
                          <Link href={`/knowledge/admin/${d.id}`} className="flex items-center gap-3">
                            <DeptMonogram name={d.name} size="sm" muted={!!d.archived_at} />
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                <span className={`font-medium ${d.archived_at ? 'text-gray-500' : 'text-gray-900'} group-hover:underline`}>{d.name}</span>
                                {d.archived_at && <span className="rounded-full bg-[#ebe8e2] px-2 py-0.5 text-[10px] font-medium text-gray-500">Archived</span>}
                              </span>
                              {d.description && <span className="block max-w-xs truncate text-[11px] text-gray-500">{d.description}</span>}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3.5">
                          {g ? (
                            <span className="inline-flex items-center gap-2">
                              <Avatar name={displayName(g)} size="xs" />
                              <span className="whitespace-nowrap text-gray-700">{displayName(g)}</span>
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                          {warning && (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700">
                              <AlertTriangle size={11} /> {d.guardian_id ? 'Guardian deactivated' : 'No Guardian'}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums">{count(members, d.id)}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums">{count(items, d.id, (i) => i.status === 'published')}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums">{count(items, d.id, (i) => i.status !== 'archived' && !!i.draft_version_id)}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums">
                          {open > 0 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{open}</span> : <span className="text-gray-300">0</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-gray-500">{last ? timeAgo(last) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-3.5">
                          <Link href={`/knowledge/admin/${d.id}`} className="text-gray-300 transition-colors group-hover:text-gray-600" aria-label={`Open ${d.name}`}>
                            <ChevronRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-400">
            Admins can see every department’s content but don’t publish it — only each department’s Guardian can. Membership changes apply on the member’s very next request.
          </p>
        </section>
      </div>
    </div>
  )
}
