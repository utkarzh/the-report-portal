export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowUpRight, Inbox, MessagesSquare } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireKbAdmin } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { guardianWarningFor, loadUserOptions } from '@/lib/knowledge/admin-data'
import { loadDepartmentContent } from '@/lib/knowledge/manage-data'
import { plural } from '@/lib/knowledge/format'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import DepartmentSettings, { type MemberRow } from '@/components/knowledge/admin/DepartmentSettings'
import ContentTable from '@/components/knowledge/ContentTable'
import { Avatar, DeptMonogram, SectionHeader } from '@/components/knowledge/kb-ui'
import type { KnowledgeDepartment } from '@/types'

export default async function KnowledgeAdminDepartmentPage({ params }: { params: { deptId: string } }) {
  await requireKbAdmin()
  const { data: deptRow } = await supabaseAdmin.from('knowledge_departments').select('*').eq('id', params.deptId).maybeSingle()
  if (!deptRow) notFound()
  const department = deptRow as KnowledgeDepartment

  const [{ data: memberRows }, users, content, { data: guardian }, { count: openCount }] = await Promise.all([
    supabaseAdmin.from('knowledge_department_members').select('user_id').eq('department_id', department.id),
    loadUserOptions(),
    loadDepartmentContent(department.id),
    department.guardian_id
      ? supabaseAdmin.from('profiles').select('full_name, email, status').eq('id', department.guardian_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('knowledge_feedback').select('id', { count: 'exact', head: true }).eq('department_id', department.id).eq('status', 'open'),
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
  const guardianName = displayName(guardian)
  const published = content.rows.filter((r) => r.state === 'published' || r.state === 'published_with_draft').length

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <Breadcrumbs items={[{ label: 'Knowledge Base', href: '/knowledge' }, { label: 'Admin', href: '/knowledge/admin' }, { label: department.name }]} />

        <div className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <DeptMonogram name={department.name} size="lg" muted={!!department.archived_at} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight text-gray-900">{department.name}</h1>
                  {department.archived_at && <span className="rounded-full bg-[#ebe8e2] px-2 py-0.5 text-[10px] font-medium text-gray-500">Archived</span>}
                </div>
                {department.description && <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">{department.description}</p>}
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-wrap gap-2">
              <Link
                href={`/knowledge/admin/chats?department=${department.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400"
              >
                <MessagesSquare size={13} /> Questions asked
              </Link>
              <Link
                href={`/knowledge/manage/${department.id}?tab=review`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400"
              >
                <Inbox size={13} /> Review queue{openCount ? ` (${openCount})` : ''} <ArrowUpRight size={11} className="text-gray-400" />
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#eceae5] px-6 py-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-2">
              {guardianName && <Avatar name={guardianName} size="xs" />}
              Guardian <span className="font-medium text-gray-800">{guardianName ?? 'not assigned'}</span>
            </span>
            <span>{plural(members.length, 'member')}</span>
            <span>{plural(published, 'published item')}</span>
            <span>{plural(content.topics.length, 'topic')}</span>
          </div>
        </div>

        <div className="mt-6">
          <DepartmentSettings
            key={department.updated_at}
            department={department}
            users={users}
            members={members}
            guardianWarning={department.archived_at ? null : guardianWarningFor(guardian, !!department.guardian_id)}
            columns
          />
        </div>

        <section className="mt-8">
          <SectionHeader title="Content" count={content.rows.length} action={<span className="text-[11px] text-gray-400">Read-only — only the Guardian publishes</span>} />
          <ContentTable rows={content.rows} itemHrefBase={`/knowledge/manage/${department.id}/items`} canEdit={false} />
        </section>
      </div>
    </div>
  )
}
