export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, ShieldCheck, AlertTriangle } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { loadUserOptions } from '@/lib/knowledge/admin-data'
import KnowledgeNav from '@/components/knowledge/KnowledgeNav'
import DepartmentFormModal, { type UserOption } from '@/components/knowledge/admin/DepartmentFormModal'
import type { KnowledgeDepartment } from '@/types'

// The Guardian's departments. Admins see every department and can create one
// right here (pre-selected with themselves as Guardian), so they don't have to
// find Admin → Knowledge Base first.
export default async function KnowledgeManagePage() {
  const ctx = await getKbPageContext()
  if (!ctx.showManage) redirect('/knowledge')

  let departments: KnowledgeDepartment[] = ctx.guarded
  let users: UserOption[] = []
  if (ctx.isAdmin) {
    const [{ data }, options] = await Promise.all([
      supabaseAdmin.from('knowledge_departments').select('*').is('archived_at', null).order('name'),
      loadUserOptions(),
    ])
    departments = (data || []) as KnowledgeDepartment[]
    users = options
  }
  const ids = departments.map((d) => d.id)
  const [{ data: items }, { data: feedback }] = await Promise.all([
    ids.length ? supabaseAdmin.from('knowledge_items').select('department_id, status, draft_version_id').in('department_id', ids) : Promise.resolve({ data: [] as { department_id: string; status: string; draft_version_id: string | null }[] }),
    ids.length ? supabaseAdmin.from('knowledge_feedback').select('department_id').in('department_id', ids).eq('status', 'open') : Promise.resolve({ data: [] as { department_id: string }[] }),
  ])
  const stat = (id: string) => {
    const its = (items || []).filter((i) => i.department_id === id)
    return {
      published: its.filter((i) => i.status === 'published').length,
      drafts: its.filter((i) => i.status !== 'archived' && i.draft_version_id).length,
      open: (feedback || []).filter((f) => f.department_id === id).length,
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <KnowledgeNav active="manage" showManage subtitle="Organise, write and publish your department’s knowledge, and review what users send you." />
        {ctx.isAdmin && (
          <div className="mb-5 flex flex-col gap-4 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-xs text-[#7a5a24]">
              <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                As an admin you can see every department here, but you can only edit and publish where you are the Guardian. Members and
                Guardians are managed in{' '}
                <Link href="/admin/knowledge" className="font-medium underline hover:text-black">Admin → Knowledge Base</Link>.
              </span>
            </p>
            <div className="flex-shrink-0">
              <DepartmentFormModal users={users} defaultGuardianId={ctx.actor.id} redirectBase="/knowledge/manage" />
            </div>
          </div>
        )}
        {departments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e5e3df] bg-white p-10 text-center">
            <p className="text-sm text-gray-500">No departments yet.</p>
            {ctx.isAdmin && (
              <p className="mt-1 text-xs text-gray-400">Click “New department” above to create the first one — you’ll be its Guardian unless you pick someone else.</p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((d) => {
              const s = stat(d.id)
              return (
                <Link key={d.id} href={`/knowledge/manage/${d.id}`} className="group rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm hover:shadow-md">
                  <div className="flex items-start justify-between">
                    <h2 className="text-sm font-semibold text-gray-900">{d.name}</h2>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500" />
                  </div>
                  {!d.guardian_id && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={11} /> No Guardian — read-only</p>
                  )}
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    {[
                      ['Published', s.published],
                      ['Drafts', s.drafts],
                      ['Open feedback', s.open],
                    ].map(([label, n]) => (
                      <div key={label as string} className="rounded-lg bg-[#faf9f7] px-2 py-2">
                        <dt className="text-[10px] uppercase tracking-wider text-gray-400">{label}</dt>
                        <dd className={`mt-0.5 text-base font-semibold ${label === 'Open feedback' && (n as number) > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{n}</dd>
                      </div>
                    ))}
                  </dl>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
