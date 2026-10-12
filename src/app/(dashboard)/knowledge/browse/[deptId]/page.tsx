export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, CalendarDays, Download, ExternalLink, FolderOpen, Layers } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { ITEM_TYPE_LABELS } from '@/lib/knowledge/constants'
import { plural, timeAgo } from '@/lib/knowledge/format'
import KnowledgeHeader from '@/components/knowledge/KnowledgeHeader'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import SuggestButton from '@/components/knowledge/SuggestButton'
import { Avatar, DeptMonogram, EmptyState, ExampleBadge, FilterChips, TypeTile } from '@/components/knowledge/kb-ui'
import type { KnowledgeItem, KnowledgeItemType, KnowledgeTopic } from '@/types'

const TYPE_FILTERS: { key: 'all' | KnowledgeItemType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'text', label: 'Guides' },
  { key: 'document', label: 'Documents' },
  { key: 'video', label: 'Videos' },
  { key: 'link', label: 'Links' },
]

export default async function KnowledgeDepartmentBrowsePage({ params, searchParams }: { params: { deptId: string }; searchParams: { type?: string } }) {
  const ctx = await getKbPageContext()
  const dept = ctx.departments.find((d) => d.id === params.deptId)
  if (!dept) notFound()

  const [{ data: topics }, { data: items }, { data: guardian }] = await Promise.all([
    supabaseAdmin.from('knowledge_topics').select('*').eq('department_id', dept.id).order('position').order('name'),
    supabaseAdmin
      .from('knowledge_items')
      .select('*')
      .eq('department_id', dept.id)
      .eq('status', 'published')
      .order('title'),
    dept.guardian_id
      ? supabaseAdmin.from('profiles').select('full_name, email').eq('id', dept.guardian_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const guardianName = displayName(guardian)
  const all = (items || []) as KnowledgeItem[]
  const topicList = (topics || []) as KnowledgeTopic[]

  const typeFilter = TYPE_FILTERS.some((f) => f.key === searchParams.type) ? (searchParams.type as 'all' | KnowledgeItemType) : 'all'
  const visible = typeFilter === 'all' ? all : all.filter((i) => i.type === typeFilter)
  const lastUpdated = all.reduce<string | null>((acc, i) => (i.last_published_at && (!acc || i.last_published_at > acc) ? i.last_published_at : acc), null)

  // Published versions for link targets (videos/links open their URL).
  const versionIds = all.map((i) => i.published_version_id).filter(Boolean) as string[]
  const { data: versions } = versionIds.length
    ? await supabaseAdmin.from('knowledge_item_versions').select('id, url').in('id', versionIds)
    : { data: [] as { id: string; url: string | null }[] }
  const urlByVersion = new Map((versions || []).map((v) => [v.id, v.url]))

  const groups: { topic: KnowledgeTopic | null; items: KnowledgeItem[] }[] = [
    ...topicList.map((t) => ({ topic: t, items: visible.filter((i) => i.topic_id === t.id) })),
    { topic: null, items: visible.filter((i) => !i.topic_id || !topicList.some((t) => t.id === i.topic_id)) },
  ].filter((g) => g.items.length > 0)

  const basePath = `/knowledge/browse/${dept.id}`

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <KnowledgeHeader ctx={ctx} active="browse" adminBar={false} />
        <Breadcrumbs items={[{ label: 'Browse', href: '/knowledge/browse' }, { label: dept.name }]} />

        <div className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <DeptMonogram name={dept.name} size="lg" />
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">{dept.name}</h2>
                {dept.description && <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">{dept.description}</p>}
              </div>
            </div>
            <SuggestButton target={{ mode: 'suggest-new', departmentId: dept.id }} departments={[{ id: dept.id, name: dept.name }]} />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#eceae5] px-6 py-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-2">
              {guardianName ? <Avatar name={guardianName} size="xs" /> : null}
              Guardian <span className="font-medium text-gray-800">{guardianName ?? 'not assigned'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Layers size={12} className="text-gray-400" /> {plural(all.length, 'published item')} · {plural(topicList.length, 'topic')}
            </span>
            {lastUpdated && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={12} className="text-gray-400" /> Updated {timeAgo(lastUpdated)}
              </span>
            )}
          </div>
        </div>

        {all.length === 0 ? (
          <EmptyState icon={FolderOpen} title="Nothing has been published here yet" className="mt-6">
            When {guardianName ?? 'the Guardian'} publishes guides, documents or videos for {dept.name}, they’ll appear here. Missing something? Use “Suggest new knowledge”.
          </EmptyState>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-6 rounded-2xl border border-[#e5e3df] bg-white p-3 shadow-sm">
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Topics</p>
                <ul className="flex flex-col gap-0.5">
                  {groups.map((g) => (
                    <li key={g.topic?.id ?? 'other'}>
                      <a
                        href={`#topic-${g.topic?.id ?? 'other'}`}
                        className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-gray-600 transition-colors hover:bg-[#faf9f7] hover:text-gray-900"
                      >
                        <span className="truncate">{g.topic?.name ?? 'Other'}</span>
                        <span className="text-[11px] tabular-nums text-gray-400">{g.items.length}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>

            <div className="min-w-0">
              <div className="mb-4">
                <FilterChips
                  active={typeFilter}
                  options={TYPE_FILTERS.map((f) => ({
                    key: f.key,
                    label: f.label,
                    href: f.key === 'all' ? basePath : `${basePath}?type=${f.key}`,
                    count: f.key === 'all' ? all.length : all.filter((i) => i.type === f.key).length,
                  })).filter((o) => o.key === 'all' || (o.count ?? 0) > 0)}
                />
              </div>

              {groups.length === 0 ? (
                <EmptyState icon={FolderOpen} title="No items of this type">
                  <Link href={basePath} className="font-medium text-gray-700 underline-offset-2 hover:underline">
                    Show everything
                  </Link>
                </EmptyState>
              ) : (
                <div className="flex flex-col gap-6">
                  {groups.map((g) => (
                    <section
                      key={g.topic?.id ?? 'other'}
                      id={`topic-${g.topic?.id ?? 'other'}`}
                      className="scroll-mt-6 overflow-hidden rounded-2xl border border-[#e5e3df] bg-white shadow-sm"
                    >
                      <div className="flex items-center justify-between border-b border-[#eceae5] bg-[#fcfbf9] px-5 py-3">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-600">{g.topic?.name ?? 'Other'}</h3>
                        <span className="text-[11px] text-gray-400">{plural(g.items.length, 'item')}</span>
                      </div>
                      <ul className="divide-y divide-[#f0efec]">
                        {g.items.map((i) => {
                          const url = i.published_version_id ? urlByVersion.get(i.published_version_id) : null
                          const external = (i.type === 'video' || i.type === 'link') && !!url
                          return (
                            <li key={i.id} className="group flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-[#faf9f7] sm:flex-row sm:items-start">
                              <div className="flex min-w-0 flex-1 items-start gap-3.5">
                                <TypeTile type={i.type} example={i.is_example} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Link href={`/knowledge/items/${i.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                                      {i.title}
                                    </Link>
                                    {i.is_example && <ExampleBadge compact />}
                                  </div>
                                  {i.description && <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-gray-500">{i.description}</p>}
                                  <p className="mt-1 text-[11px] text-gray-400">
                                    {ITEM_TYPE_LABELS[i.type]}
                                    {i.last_published_at ? ` · Updated ${timeAgo(i.last_published_at)}` : ''}
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-2 pl-[3.25rem] sm:pl-0">
                                {external ? (
                                  <a
                                    href={url!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400"
                                  >
                                    <ExternalLink size={12} /> {i.type === 'video' ? 'Watch' : 'Open link'}
                                  </a>
                                ) : i.type === 'document' ? (
                                  <a
                                    href={`/api/knowledge/items/${i.id}/download`}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400"
                                  >
                                    <Download size={12} /> Download
                                  </a>
                                ) : null}
                                <Link
                                  href={`/knowledge/items/${i.id}`}
                                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-white hover:text-gray-900"
                                >
                                  {i.type === 'text' ? 'Read' : 'Details'} <ArrowRight size={12} />
                                </Link>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
