export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download, ExternalLink, Sparkles } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { ITEM_TYPE_LABELS } from '@/lib/knowledge/constants'
import { formatDayMonthYear } from '@/lib/date-format'
import KnowledgeNav from '@/components/knowledge/KnowledgeNav'
import ItemTypeIcon from '@/components/knowledge/ItemTypeIcon'
import SuggestButton from '@/components/knowledge/SuggestButton'
import type { KnowledgeItem, KnowledgeTopic } from '@/types'

export default async function KnowledgeDepartmentBrowsePage({ params }: { params: { deptId: string } }) {
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
  const guardianName = displayName(guardian) ?? 'not assigned'

  // Published versions for link targets (videos/links open their URL).
  const versionIds = (items || []).map((i) => i.published_version_id).filter(Boolean) as string[]
  const { data: versions } = versionIds.length
    ? await supabaseAdmin.from('knowledge_item_versions').select('id, url').in('id', versionIds)
    : { data: [] as { id: string; url: string | null }[] }
  const urlByVersion = new Map((versions || []).map((v) => [v.id, v.url]))

  const groups: { topic: KnowledgeTopic | null; items: KnowledgeItem[] }[] = [
    ...((topics || []) as KnowledgeTopic[]).map((t) => ({ topic: t, items: (items || []).filter((i) => i.topic_id === t.id) as KnowledgeItem[] })),
    { topic: null, items: (items || []).filter((i) => !i.topic_id || !(topics || []).some((t) => t.id === i.topic_id)) as KnowledgeItem[] },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <KnowledgeNav active="browse" showManage={ctx.showManage} />

        <Link href="/knowledge/browse" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black">
          <ArrowLeft size={13} /> All departments
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{dept.name}</h2>
            {dept.description && <p className="mt-1 max-w-2xl text-sm text-gray-500">{dept.description}</p>}
            <p className="mt-1.5 text-xs text-gray-500">Guardian: {guardianName}</p>
          </div>
          <SuggestButton target={{ mode: 'suggest-new', departmentId: dept.id }} departments={[{ id: dept.id, name: dept.name }]} />
        </div>

        {groups.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-[#e5e3df] bg-white p-10 text-center text-sm text-gray-500">
            Nothing has been published in this department yet.
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            {groups.map((g) => (
              <section key={g.topic?.id ?? 'unsorted'} className="rounded-xl border border-[#e5e3df] bg-white">
                <h3 className="border-b border-[#e5e3df] px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                  {g.topic?.name ?? 'Other'}
                </h3>
                <ul className="divide-y divide-[#f0efec]">
                  {g.items.map((i) => {
                    const url = i.published_version_id ? urlByVersion.get(i.published_version_id) : null
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                        <ItemTypeIcon type={i.type} className="flex-shrink-0 text-gray-400" />
                        <div className="min-w-0 flex-1">
                          <Link href={`/knowledge/items/${i.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                            {i.title}
                          </Link>
                          {i.is_example && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#fbf7ed] px-2 py-0.5 align-middle text-[10px] font-medium text-[#a07530]">
                              <Sparkles size={10} /> Example
                            </span>
                          )}
                          {i.description && <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{i.description}</p>}
                          <p className="mt-0.5 text-[11px] text-gray-400">
                            {ITEM_TYPE_LABELS[i.type]} · Guardian: {guardianName}
                            {i.last_published_at ? ` · Updated ${formatDayMonthYear(i.last_published_at)}` : ''}
                          </p>
                        </div>
                        {(i.type === 'video' || i.type === 'link') && url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-black">
                            <ExternalLink size={13} /> {i.type === 'video' ? 'Watch' : 'Open'}
                          </a>
                        ) : (
                          <a href={`/api/knowledge/items/${i.id}/download`} className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-black">
                            <Download size={13} /> Download
                          </a>
                        )}
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
  )
}
