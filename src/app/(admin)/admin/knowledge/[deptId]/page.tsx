export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { requireAdminHeader } from '@/lib/auth/session'
import { knowledgeBaseInstalled } from '@/lib/knowledge/installed'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { displayName } from '@/lib/knowledge/access'
import { guardianWarningFor, loadUserOptions } from '@/lib/knowledge/admin-data'
import { loadDepartmentContent } from '@/lib/knowledge/manage-data'
import DepartmentSettings, { type MemberRow } from '@/components/knowledge/admin/DepartmentSettings'
import ContentTable from '@/components/knowledge/ContentTable'
import type { KnowledgeDepartment } from '@/types'

export default async function AdminKnowledgeDepartmentPage({ params }: { params: { deptId: string } }) {
  requireAdminHeader()
  if (!(await knowledgeBaseInstalled())) redirect('/knowledge/setup')
  const { data: deptRow } = await supabaseAdmin.from('knowledge_departments').select('*').eq('id', params.deptId).maybeSingle()
  if (!deptRow) notFound()
  const department = deptRow as KnowledgeDepartment

  const [{ data: memberRows }, users, content, { data: guardian }] = await Promise.all([
    supabaseAdmin.from('knowledge_department_members').select('user_id').eq('department_id', department.id),
    loadUserOptions(),
    loadDepartmentContent(department.id),
    department.guardian_id
      ? supabaseAdmin.from('profiles').select('status').eq('id', department.guardian_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const memberIds = (memberRows || []).map((m) => m.user_id as string)
  const { data: profiles } = memberIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, email, status, role, can_access_knowledge_base').in('id', memberIds)
    : { data: [] as { id: string; full_name: string | null; email: string; status: string; role: string; can_access_knowledge_base: boolean }[] }
  const members: MemberRow[] = (profiles || [])
    .map((p) => ({
      id: p.id,
      name: displayName(p) ?? p.email,
      email: p.email,
      status: p.status,
      canAccess: p.role === 'admin' || !!p.can_access_knowledge_base,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <Link href="/admin/knowledge" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black">
          <ArrowLeft size={13} /> Knowledge Base
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-lg font-semibold text-gray-900">{department.name}</h1>
          <div className="flex gap-3 text-xs">
            <Link href={`/admin/knowledge/chats?department=${department.id}`} className="font-medium text-gray-600 hover:text-black">Chats for this department</Link>
            <Link href={`/knowledge/manage/${department.id}?tab=review`} className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-black">
              Review queue <ExternalLink size={11} />
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 order-2 lg:order-1">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Content ({content.rows.length})</p>
            <ContentTable rows={content.rows} itemHref={(id) => `/knowledge/manage/${department.id}/items/${id}`} canEdit={false} />
          </div>
          <div className="order-1 lg:order-2">
            <DepartmentSettings
              key={department.updated_at}
              department={department}
              users={users}
              members={members}
              guardianWarning={department.archived_at ? null : guardianWarningFor(guardian, !!department.guardian_id)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
