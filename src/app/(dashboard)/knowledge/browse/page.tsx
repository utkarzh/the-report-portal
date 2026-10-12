export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowUpRight, ChevronRight, FolderSearch, LibraryBig, SearchX, Sparkles } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { ITEM_TYPE_LABELS } from '@/lib/knowledge/constants'
import { orIlikeFilter } from '@/lib/search'
import { plural, timeAgo } from '@/lib/knowledge/format'
import KnowledgeHeader from '@/components/knowledge/KnowledgeHeader'
import { Avatar, DeptMonogram, EmptyState, ExampleBadge, SectionHeader, TypeTile } from '@/components/knowledge/kb-ui'
import SearchInput from '@/components/ui/SearchInput'
import type { KnowledgeItemType } from '@/types'

interface PublishedRow {
  id: string
  title: string
  description: string
  type: KnowledgeItemType
  department_id: string
  topic_id: string | null
  is_example: boolean
  last_published_at: string | null
}

// Wraps every case-insensitive occurrence of `term` in <mark>.
function Highlight({ text, term }: { text: string; term: string }) {
  const t = term.trim()
  if (!t) return <>{text}</>
  const parts = text.split(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'))
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === t.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-[#fbf0d4] px-0.5 text-inherit">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

// US-114: the user's departments → topics → published items, a search across
// those departments only, plus what changed recently and the examples of
// excellent work.
export default async function KnowledgeBrowsePage({ searchParams }: { searchParams: { search?: string } }) {
  const ctx = await getKbPageContext()
  const deptIds = ctx.departments.map((d) => d.id)
  const search = typeof searchParams.search === 'string' ? searchParams.search.trim() : ''

  const guardianIds = Array.from(new Set(ctx.departments.map((d) => d.guardian_id).filter(Boolean))) as string[]
  const [{ data: guardians }, { data: published }, { data: topics }, searchResult] = await Promise.all([
    guardianIds.length
      ? supabaseAdmin.from('profiles').select('id, full_name, email').in('id', guardianIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    deptIds.length
      ? supabaseAdmin
          .from('knowledge_items')
          .select('id, title, description, type, department_id, topic_id, is_example, last_published_at')
          .in('department_id', deptIds)
          .eq('status', 'published')
          .order('last_published_at', { ascending: false, nullsFirst: false })
          .limit(2000)
      : Promise.resolve({ data: [] as PublishedRow[] }),
    deptIds.length
      ? supabaseAdmin.from('knowledge_topics').select('id, name, department_id').in('department_id', deptIds)
      : Promise.resolve({ data: [] as { id: string; name: string; department_id: string }[] }),
    search && deptIds.length
      ? supabaseAdmin
          .from('knowledge_items')
          .select('id, title, description, type, department_id, topic_id, is_example, last_published_at')
          .in('department_id', deptIds)
          .eq('status', 'published')
          .or(orIlikeFilter(['title', 'description'], search))
          .order('title')
          .limit(50)
      : Promise.resolve({ data: null }),
  ])
  const items = (published || []) as PublishedRow[]
  const guardianMap = new Map((guardians || []).map((g) => [g.id, displayName(g)]))
  const deptName = new Map(ctx.departments.map((d) => [d.id, d.name]))
  const topicName = new Map((topics || []).map((t) => [t.id, t.name as string]))
  const stats = new Map<string, { items: number; last: string | null }>()
  for (const i of items) {
    const s = stats.get(i.department_id) ?? { items: 0, last: null }
    s.items++
    if (i.last_published_at && (!s.last || i.last_published_at > s.last)) s.last = i.last_published_at
    stats.set(i.department_id, s)
  }
  const topicCount = new Map<string, number>()
  for (const t of topics || []) topicCount.set(t.department_id, (topicCount.get(t.department_id) ?? 0) + 1)
  const recent = items.slice(0, 6)
  const examples = items.filter((i) => i.is_example).slice(0, 6)
  const results = (searchResult.data || null) as PublishedRow[] | null

  const itemRow = (i: PublishedRow, term = '') => (
    <li key={i.id}>
      <Link href={`/knowledge/items/${i.id}`} className="group flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-[#faf9f7]">
        <TypeTile type={i.type} size="sm" example={i.is_example} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">
            <Highlight text={i.title} term={term} />
          </p>
          {term && i.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">
              <Highlight text={i.description} term={term} />
            </p>
          )}
          <p className="mt-0.5 truncate text-[11px] text-gray-400">
            {ITEM_TYPE_LABELS[i.type]} · {deptName.get(i.department_id)}
            {i.topic_id && topicName.get(i.topic_id) ? ` · ${topicName.get(i.topic_id)}` : ''}
            {i.last_published_at ? ` · Updated ${timeAgo(i.last_published_at)}` : ''}
          </p>
        </div>
        <ChevronRight size={14} className="mt-1 flex-shrink-0 text-gray-300 transition-colors group-hover:text-gray-500" />
      </Link>
    </li>
  )

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <KnowledgeHeader ctx={ctx} active="browse" />

        {ctx.departments.length === 0 ? (
          <EmptyState icon={FolderSearch} title="You haven’t been added to a department yet">
            Knowledge is shared by department, so there’s nothing to browse until an admin adds you to yours.
          </EmptyState>
        ) : (
          <>
            <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SearchInput basePath="/knowledge/browse" initialValue={search} placeholder="Search guides, documents and videos by title or description…" className="!max-w-xl" />
              <p className="text-xs text-gray-400">
                {plural(items.length, 'published item')} across {plural(ctx.departments.length, 'department')}
              </p>
            </div>

            {results ? (
              <section>
                <SectionHeader title={`Results for “${search}”`} count={results.length} />
                {results.length === 0 ? (
                  <EmptyState
                    icon={SearchX}
                    title="Nothing matches that search"
                    action={
                      <Link href={`/knowledge?q=${encodeURIComponent(search)}`} className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-900">
                        Ask the Knowledge Base instead
                      </Link>
                    }
                  >
                    Search looks at titles and descriptions. Asking a question also reads inside every published document.
                  </EmptyState>
                ) : (
                  <ul className="divide-y divide-[#f0efec] overflow-hidden rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
                    {results.map((i) => itemRow(i, search))}
                  </ul>
                )}
              </section>
            ) : (
              <>
                <section>
                  <SectionHeader title={ctx.isAdmin ? 'All departments' : 'Your departments'} count={ctx.departments.length} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {ctx.departments.map((d) => {
                      const s = stats.get(d.id) ?? { items: 0, last: null }
                      const guardian = d.guardian_id ? guardianMap.get(d.guardian_id) ?? null : null
                      return (
                        <Link
                          key={d.id}
                          href={`/knowledge/browse/${d.id}`}
                          className="group relative flex flex-col rounded-2xl border border-[#e5e3df] bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[#c8973f]/40 hover:shadow-md"
                        >
                          <div className="flex items-start gap-3">
                            <DeptMonogram name={d.name} />
                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-sm font-semibold text-gray-900">{d.name}</h3>
                              <p className="mt-0.5 text-[11px] text-gray-500">
                                {plural(s.items, 'item')} · {plural(topicCount.get(d.id) ?? 0, 'topic')}
                              </p>
                            </div>
                            <ArrowUpRight size={16} className="flex-shrink-0 text-gray-300 transition-colors group-hover:text-[#a07530]" />
                          </div>
                          <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-gray-500">{d.description || 'No description yet.'}</p>
                          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#f0efec] pt-3 text-[11px]">
                            <span className="flex min-w-0 items-center gap-1.5 text-gray-600">
                              {guardian ? <Avatar name={guardian} size="xs" /> : null}
                              <span className="truncate">{guardian ?? <span className="text-amber-700">No Guardian</span>}</span>
                            </span>
                            <span className="flex-shrink-0 text-gray-400">{s.last ? `Updated ${timeAgo(s.last)}` : 'Nothing published yet'}</span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </section>

                {items.length > 0 && (
                  <div className={`mt-10 grid gap-6 ${examples.length ? 'lg:grid-cols-2' : ''}`}>
                    <section>
                      <SectionHeader title="Recently updated" />
                      <ul className="divide-y divide-[#f0efec] overflow-hidden rounded-2xl border border-[#e5e3df] bg-white shadow-sm">{recent.map((i) => itemRow(i))}</ul>
                    </section>
                    {examples.length > 0 && (
                      <section>
                        <SectionHeader title="Examples of excellent work" action={<ExampleBadge compact />} />
                        <ul className="divide-y divide-[#f0efec] overflow-hidden rounded-2xl border border-[#c8973f]/25 bg-white shadow-sm">{examples.map((i) => itemRow(i))}</ul>
                      </section>
                    )}
                  </div>
                )}

                {items.length === 0 && (
                  <EmptyState icon={LibraryBig} title="Nothing has been published yet" className="mt-8">
                    Each department’s Guardian publishes its guides, documents and videos. They’ll appear here as soon as they go live.
                  </EmptyState>
                )}

                {examples.length === 0 && items.length > 0 && (
                  <p className="mt-6 flex items-center gap-1.5 text-[11px] text-gray-400">
                    <Sparkles size={11} className="text-[#a07530]" /> Guardians can mark items as examples of excellent work — they’ll be collected here.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
