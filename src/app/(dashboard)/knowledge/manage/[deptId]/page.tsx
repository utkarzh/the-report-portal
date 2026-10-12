export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, BookOpen, Eye, FolderOpen, Link2 } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { departmentForManagement, displayName } from '@/lib/knowledge/access'
import { loadDepartmentContent, loadReviewEntries } from '@/lib/knowledge/manage-data'
import KnowledgeHeader from '@/components/knowledge/KnowledgeHeader'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import TopicsManager from '@/components/knowledge/TopicsManager'
import BulkUpload from '@/components/knowledge/BulkUpload'
import ContentTable from '@/components/knowledge/ContentTable'
import ReviewQueue from '@/components/knowledge/ReviewQueue'
import { Avatar, DeptMonogram, FilterChips } from '@/components/knowledge/kb-ui'

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
  const reviewShow = searchParams.show === 'all' ? 'all' : 'open'
  const reviewEntries = tab === 'review' ? await loadReviewEntries(department.id, reviewShow) : []
  const isGuardian = department.guardian_id === ctx.actor.id
  const guardianName = displayName(guardian)
  const topicQs = topic && topic !== 'unsorted' ? `&topic=${topic}` : ''

  const stats = [
    { label: 'Published', n: rows.filter((r) => r.state === 'published' || r.state === 'published_with_draft').length, tone: 'text-gray-900' },
    { label: 'Drafts', n: rows.filter((r) => r.item.status !== 'archived' && r.item.draft_version_id).length, tone: 'text-gray-900' },
    { label: 'Needs attention', n: rows.filter((r) => r.state === 'needs_attention').length, tone: 'text-red-700' },
    { label: 'Open feedback', n: openCount ?? 0, tone: 'text-amber-700', href: `${basePath}?tab=review` },
    { label: 'Archived', n: rows.filter((r) => r.state === 'archived').length, tone: 'text-gray-900' },
  ]

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-7xl mx-auto">
        <KnowledgeHeader ctx={ctx} active="manage" adminBar={false} subtitle="Write, publish and keep your department’s knowledge up to date, and act on what colleagues send you." />
        <Breadcrumbs items={[{ label: 'Manage', href: '/knowledge/manage' }, { label: department.name }]} />

        <div className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
          <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <DeptMonogram name={department.name} size="lg" muted={!!department.archived_at} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight text-gray-900">{department.name}</h2>
                  {isGuardian && canEdit ? (
                    <span className="rounded-full border border-[#c8973f]/25 bg-[#fbf7ed] px-2 py-0.5 text-[10px] font-medium text-[#a07530]">You’re the Guardian</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#f7f6f3] px-2 py-0.5 text-[10px] font-medium text-gray-500">
                      <Eye size={10} /> View only
                    </span>
                  )}
                </div>
                {department.description && <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">{department.description}</p>}
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-500">
                  {guardianName && <Avatar name={guardianName} size="xs" />}
                  Guardian <span className="font-medium text-gray-800">{guardianName ?? 'not assigned'}</span>
                  {guardian && guardian.status !== 'active' && <span className="text-amber-700">(deactivated)</span>}
                </p>
              </div>
            </div>
            {canEdit && (
              <div className="flex flex-shrink-0 flex-wrap gap-2">
                <BulkUpload departmentId={department.id} topics={topics} defaultTopicId={topic} />
                <Link
                  href={`${basePath}/new?type=text${topicQs}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-gray-400"
                >
                  <BookOpen size={14} /> Write a guide
                </Link>
                <Link
                  href={`${basePath}/new?type=link${topicQs}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-gray-400"
                >
                  <Link2 size={14} /> Add video or link
                </Link>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 divide-[#eceae5] border-t border-[#eceae5] sm:grid-cols-5 sm:divide-x">
            {stats.map((s) => {
              const inner = (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{s.label}</p>
                  <p className={`mt-1 text-lg font-semibold tabular-nums leading-none ${s.n ? s.tone : 'text-gray-300'}`}>{s.n}</p>
                </>
              )
              return s.href ? (
                <Link key={s.label} href={s.href} className="block px-6 py-3.5 transition-colors hover:bg-[#faf9f7]">
                  {inner}
                </Link>
              ) : (
                <div key={s.label} className="px-6 py-3.5">
                  {inner}
                </div>
              )
            })}
          </div>
        </div>

        {!canEdit && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
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
            { key: 'content', label: 'Content', count: rows.length, href: basePath, amber: false },
            { key: 'review', label: 'Review queue', count: openCount ?? 0, href: `${basePath}?tab=review`, amber: true },
          ].map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm transition-colors ${
                tab === t.key ? 'border-black font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.key === 'content' ? <FolderOpen size={15} /> : null}
              {t.label}
              <span
                className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                  t.amber && t.count > 0 ? 'bg-amber-100 text-amber-800' : 'bg-[#f0efec] text-gray-500'
                }`}
              >
                {t.count}
              </span>
            </Link>
          ))}
        </nav>

        {tab === 'content' ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
            <TopicsManager departmentId={department.id} topics={topics} counts={counts} activeTopic={topic} canEdit={canEdit} basePath={basePath} />
            <ContentTable rows={filtered} itemHrefBase={`${basePath}/items`} canEdit={canEdit} />
          </div>
        ) : (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <FilterChips
                active={reviewShow}
                options={[
                  { key: 'open', label: 'Open', href: `${basePath}?tab=review`, count: openCount ?? 0 },
                  { key: 'all', label: 'All', href: `${basePath}?tab=review&show=all` },
                ]}
              />
              <p className="text-[11px] text-gray-400">Accepting opens the item as a draft — nothing changes for users until you publish.</p>
            </div>
            <ReviewQueue entries={reviewEntries} canEdit={canEdit} basePath={basePath} />
          </div>
        )}
      </div>
    </div>
  )
}
