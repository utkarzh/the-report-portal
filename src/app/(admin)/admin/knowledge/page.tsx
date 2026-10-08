export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { AlertTriangle, ChevronRight, MessagesSquare } from 'lucide-react'
import { redirect } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { knowledgeBaseInstalled } from '@/lib/knowledge/installed'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { displayName } from '@/lib/knowledge/access'
import { guardianWarningFor, loadUserOptions } from '@/lib/knowledge/admin-data'
import DepartmentFormModal from '@/components/knowledge/admin/DepartmentFormModal'
import type { KnowledgeDepartment } from '@/types'

// Admin → Knowledge Base: departments, Guardians, members (US-098, US-099,
// US-122), with the chat log one click away (US-118).
export default async function AdminKnowledgePage() {
  requireAdminHeader()
  if (!(await knowledgeBaseInstalled())) redirect('/knowledge/setup')

  const [{ data: depts }, { data: members }, { data: items }, { data: feedback }, users] = await Promise.all([
    supabaseAdmin.from('knowledge_departments').select('*').order('archived_at', { nullsFirst: true }).order('name'),
    supabaseAdmin.from('knowledge_department_members').select('department_id'),
    supabaseAdmin.from('knowledge_items').select('department_id, status, draft_version_id'),
    supabaseAdmin.from('knowledge_feedback').select('department_id').eq('status', 'open'),
    loadUserOptions(),
  ])
  const departments = (depts || []) as KnowledgeDepartment[]
  const guardianIds = Array.from(new Set(departments.map((d) => d.guardian_id).filter(Boolean))) as string[]
  const { data: guardians } = guardianIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, email, status').in('id', guardianIds)
    : { data: [] as { id: string; full_name: string | null; email: string; status: string }[] }
  const gMap = new Map((guardians || []).map((g) => [g.id, g]))
  const count = <T extends { department_id: string | null }>(rows: T[] | null, id: string, pred: (r: T) => boolean = () => true) =>
    (rows || []).filter((r) => r.department_id === id && pred(r)).length

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Knowledge Base</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
              Create departments, assign one Guardian to each and choose who belongs to them. Guardians publish the knowledge; usage and cost appear in Analytics.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/knowledge/chats" className="inline-flex items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-5 py-3 text-xs font-medium uppercase tracking-wider text-gray-800 hover:bg-gray-50">
              <MessagesSquare size={14} /> Chat log
            </Link>
            <DepartmentFormModal users={users} />
          </div>
        </div>

        {departments.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-[#e5e3df] bg-white p-10 text-center text-sm text-gray-500">
            No departments yet. Create one (e.g. Editorial, Business Development, Graphics) and assign its Guardian.
          </div>
        ) : (
          <div className="mt-8 overflow-x-auto rounded-xl border border-[#e5e3df] bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[#e5e3df] text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Guardian</th>
                  <th className="px-4 py-3 text-right">Members</th>
                  <th className="px-4 py-3 text-right">Published</th>
                  <th className="px-4 py-3 text-right">Drafts</th>
                  <th className="px-4 py-3 text-right">Open feedback</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0efec]">
                {departments.map((d) => {
                  const g = d.guardian_id ? gMap.get(d.guardian_id) ?? null : null
                  const warning = !d.archived_at ? guardianWarningFor(g, !!d.guardian_id) : null
                  return (
                    <tr key={d.id} className={d.archived_at ? 'text-gray-400' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3">
                        <Link href={`/admin/knowledge/${d.id}`} className="font-medium text-gray-900 hover:underline">{d.name}</Link>
                        {d.archived_at && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Archived</span>}
                        {d.description && <p className="line-clamp-1 text-[11px] text-gray-500">{d.description}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {g ? displayName(g) : <span className="text-gray-400">—</span>}
                        {warning && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle size={11} /> {d.guardian_id ? 'Guardian deactivated' : 'No Guardian'}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">{count(members, d.id)}</td>
                      <td className="px-4 py-3 text-right">{count(items, d.id, (i) => i.status === 'published')}</td>
                      <td className="px-4 py-3 text-right">{count(items, d.id, (i) => i.status !== 'archived' && !!i.draft_version_id)}</td>
                      <td className="px-4 py-3 text-right">{count(feedback, d.id)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/knowledge/${d.id}`} className="text-gray-300 hover:text-gray-600"><ChevronRight size={16} /></Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
