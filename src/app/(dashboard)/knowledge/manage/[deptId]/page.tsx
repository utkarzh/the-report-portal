export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BookOpen, Link2, AlertTriangle } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { departmentForManagement, displayName } from '@/lib/knowledge/access'
import { loadDepartmentContent, loadReviewEntries } from '@/lib/knowledge/manage-data'
import KnowledgeNav from '@/components/knowledge/KnowledgeNav'
import TopicsManager from '@/components/knowledge/TopicsManager'
import BulkUpload from '@/components/knowledge/BulkUpload'
import ContentTable from '@/components/knowledge/ContentTable'
import ReviewQueue from '@/components/knowledge/ReviewQueue'

export default async function KnowledgeManageDepartmentPage({
  params,
  searchParams,
}: {
  params: { deptId: string }
  searchParams: { tab?: string; topic?: string; show?: string }
}) {
  const ctx = await getKbPageContext()
  const managed = await departmentForManagement(ctx.actor, params.deptId)
  if (!managed) notFound()
  const { department, canEdit } = managed
  const tab = searchParams.tab === 'review' ? 'review' : 'content'
  const basePath = `/knowledge/manage/${department.id}`

  const [{ topics, rows, counts }, { data: guardian }, { count: openCount }] = await Promise.all([
    loadDepartmentContent(department.id),
    department.guardian_id
      ? supabaseAdmin.from('profiles').select('full_name, email, status').eq('id', department.guardian_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('knowledge_feedback').select('id', { count: 'exact', head: true }).eq('department_id', department.id).eq('status', 'open'),
  ])

  const topic = searchParams.topic || null
  const filtered =
    topic === 'unsorted'
      ? rows.filter((r) => !r.item.topic_id || !topics.some((t) => t.id === r.item.topic_id))
      : topic
        ? rows.filter((r) => r.item.topic_id === topic)
        : rows
  const reviewEntries = tab === 'review' ? await loadReviewEntries(department.id, searchParams.show === 'all' ? 'all' : 'open') : []

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-7xl mx-auto">
        <KnowledgeNav active="manage" showManage subtitle="Organise, write and publish your department’s knowledge, and review what users send you." />
        <Link href="/knowledge/manage" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black">
          <ArrowLeft size={13} /> Departments
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{department.name}</h2>
            <p className="mt-1 text-xs text-gray-500">
              Guardian: {displayName(guardian) ?? 'not assigned'}
              {guardian && guardian.status !== 'active' ? ' (deactivated)' : ''}
            </p>
          </div>
          {canEdit && tab === 'content' && (
            <div className="flex flex-wrap gap-2">
              <BulkUpload departmentId={department.id} topics={topics} defaultTopicId={topic} />
              <Link href={`${basePath}/new?type=text${topic && topic !== 'unsorted' ? `&topic=${topic}` : ''}`} className="inline-flex items-center gap-2 border border-[#e5e3df] bg-white px-4 py-2 text-xs font-medium uppercase tracking-wider text-black hover:bg-gray-50">
                <BookOpen size={13} /> Write a guide
              </Link>
              <Link href={`${basePath}/new?type=link${topic && topic !== 'unsorted' ? `&topic=${topic}` : ''}`} className="inline-flex items-center gap-2 border border-[#e5e3df] bg-white px-4 py-2 text-xs font-medium uppercase tracking-wider text-black hover:bg-gray-50">
                <Link2 size={13} /> Add video / link
              </Link>
            </div>
          )}
        </div>

        {!canEdit && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            {department.archived_at
              ? 'This department is archived — read-only.'
              : !department.guardian_id
                ? 'This department has no Guardian, so it is read-only: its published knowledge stays live, but nothing can be published until an admin assigns one.'
                : 'Read-only: only this department’s Guardian can edit and publish its knowledge.'}
          </p>
        )}

        <nav className="mt-6 flex gap-1 border-b border-[#e5e3df]">
          {[
            { key: 'content', label: 'Content', href: basePath },
            { key: 'review', label: `Review queue${openCount ? ` (${openCount})` : ''}`, href: `${basePath}?tab=review` },
          ].map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm ${tab === t.key ? 'border-black font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {tab === 'content' ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
            <TopicsManager departmentId={department.id} topics={topics} counts={counts} activeTopic={topic} canEdit={canEdit} basePath={basePath} />
            <ContentTable rows={filtered} itemHref={(id) => `${basePath}/items/${id}`} canEdit={canEdit} />
          </div>
        ) : (
          <div className="mt-6">
            <div className="mb-4 flex gap-2 text-xs">
              {[
                { key: 'open', label: 'Open' },
                { key: 'all', label: 'All' },
              ].map((f) => {
                const active = (searchParams.show === 'all' ? 'all' : 'open') === f.key
                return (
                  <Link
                    key={f.key}
                    href={`${basePath}?tab=review${f.key === 'all' ? '&show=all' : ''}`}
                    className={`rounded-full px-3 py-1 ${active ? 'bg-black text-white' : 'border border-[#e5e3df] text-gray-600 hover:bg-gray-50'}`}
                  >
                    {f.label}
                  </Link>
                )
              })}
            </div>
            <ReviewQueue entries={reviewEntries} canEdit={canEdit} basePath={basePath} />
          </div>
        )}
      </div>
    </div>
  )
}
