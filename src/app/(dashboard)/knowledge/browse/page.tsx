export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ChevronRight, FolderOpen } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { ITEM_TYPE_LABELS } from '@/lib/knowledge/constants'
import { orIlikeFilter } from '@/lib/search'
import { formatDayMonthYear } from '@/lib/date-format'
import KnowledgeNav from '@/components/knowledge/KnowledgeNav'
import ItemTypeIcon from '@/components/knowledge/ItemTypeIcon'
import SearchInput from '@/components/ui/SearchInput'
import type { KnowledgeItemType } from '@/types'

// US-114: the user's departments → topics → published items, plus a simple
// title search across those departments only.
export default async function KnowledgeBrowsePage({ searchParams }: { searchParams: { search?: string } }) {
  const ctx = await getKbPageContext()
  const deptIds = ctx.departments.map((d) => d.id)
  const search = typeof searchParams.search === 'string' ? searchParams.search.trim() : ''

  const guardianIds = Array.from(new Set(ctx.departments.map((d) => d.guardian_id).filter(Boolean))) as string[]
  const [{ data: guardians }, { data: counts }, searchResult] = await Promise.all([
    guardianIds.length
      ? supabaseAdmin.from('profiles').select('id, full_name, email').in('id', guardianIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    deptIds.length
      ? supabaseAdmin.from('knowledge_items').select('department_id').in('department_id', deptIds).eq('status', 'published')
      : Promise.resolve({ data: [] as { department_id: string }[] }),
    search && deptIds.length
      ? supabaseAdmin
          .from('knowledge_items')
          .select('id, title, type, department_id, last_published_at')
          .in('department_id', deptIds)
          .eq('status', 'published')
          .or(orIlikeFilter(['title'], search))
          .order('title')
          .limit(50)
      : Promise.resolve({ data: null }),
  ])
  const guardianMap = new Map((guardians || []).map((g) => [g.id, displayName(g)]))
  const countMap = new Map<string, number>()
  for (const c of counts || []) countMap.set(c.department_id, (countMap.get(c.department_id) ?? 0) + 1)
  const deptName = new Map(ctx.departments.map((d) => [d.id, d.name]))

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <KnowledgeNav active="browse" showManage={ctx.showManage} />

        {ctx.departments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#e5e3df] bg-white p-10 text-center text-sm text-gray-500">
            You haven’t been added to a department yet, so there’s no knowledge to browse. Ask an admin to add you to your department.
          </div>
        ) : (
          <>
            <div className="mb-6 max-w-md">
              <SearchInput basePath="/knowledge/browse" initialValue={search} placeholder="Search titles in your departments…" />
            </div>

            {searchResult.data ? (
              <div className="rounded-xl border border-[#e5e3df] bg-white">
                <p className="border-b border-[#e5e3df] px-5 py-3 text-xs text-gray-500">
                  {searchResult.data.length} result{searchResult.data.length === 1 ? '' : 's'} for “{search}”
                </p>
                <ul className="divide-y divide-[#f0efec]">
                  {searchResult.data.map((i) => (
                    <li key={i.id}>
                      <Link href={`/knowledge/items/${i.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                        <ItemTypeIcon type={i.type as KnowledgeItemType} className="text-gray-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{i.title}</p>
                          <p className="text-[11px] text-gray-500">
                            {ITEM_TYPE_LABELS[i.type as KnowledgeItemType]} · {deptName.get(i.department_id)}
                            {i.last_published_at ? ` · Updated ${formatDayMonthYear(i.last_published_at)}` : ''}
                          </p>
                        </div>
                        <ChevronRight size={14} className="text-gray-300" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ctx.departments.map((d) => (
                  <Link
                    key={d.id}
                    href={`/knowledge/browse/${d.id}`}
                    className="group rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <FolderOpen size={18} className="text-gray-400" />
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500" />
                    </div>
                    <h2 className="mt-3 text-sm font-semibold text-gray-900">{d.name}</h2>
                    {d.description && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{d.description}</p>}
                    <p className="mt-4 text-[11px] text-gray-500">
                      {countMap.get(d.id) ?? 0} published item{(countMap.get(d.id) ?? 0) === 1 ? '' : 's'} · Guardian:{' '}
                      {d.guardian_id ? guardianMap.get(d.guardian_id) ?? '—' : 'not assigned'}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
