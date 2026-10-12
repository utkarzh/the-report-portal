export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, ExternalLink, FileText, MessageCircleQuestion } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { ITEM_TYPE_LABELS, formatBytes } from '@/lib/knowledge/constants'
import { renderKbMarkdownWithToc } from '@/lib/knowledge/markdown'
import { approxWords, hostOf, timeAgo } from '@/lib/knowledge/format'
import { formatDayMonthYear } from '@/lib/date-format'
import KnowledgeHeader from '@/components/knowledge/KnowledgeHeader'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import SuggestButton from '@/components/knowledge/SuggestButton'
import { Avatar, ExampleBadge, TypeTile } from '@/components/knowledge/kb-ui'
import type { KnowledgeItem, KnowledgeItemVersion } from '@/types'

const PREVIEW_CHARS = 20_000

// One published item, as users see it (US-110, US-114). Only the current
// published version of a live item in one of the user's departments.
export default async function KnowledgeItemPage({ params }: { params: { itemId: string } }) {
  const ctx = await getKbPageContext()
  const { data: itemRow } = await supabaseAdmin.from('knowledge_items').select('*').eq('id', params.itemId).maybeSingle()
  const item = itemRow as KnowledgeItem | null
  const dept = item ? ctx.departments.find((d) => d.id === item.department_id) : null
  if (!item || !dept || item.status !== 'published' || !item.published_version_id) notFound()

  const [{ data: versionRow }, { data: guardian }, { data: topic }] = await Promise.all([
    supabaseAdmin.from('knowledge_item_versions').select('*').eq('id', item.published_version_id).single(),
    dept.guardian_id
      ? supabaseAdmin.from('profiles').select('full_name, email').eq('id', dept.guardian_id).maybeSingle()
      : Promise.resolve({ data: null }),
    item.topic_id ? supabaseAdmin.from('knowledge_topics').select('name').eq('id', item.topic_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const v = versionRow as KnowledgeItemVersion
  const guardianName = displayName(guardian)
  const external = (item.type === 'video' || item.type === 'link') && !!v.url
  const host = hostOf(v.url)
  const article = item.type === 'text' ? renderKbMarkdownWithToc(v.content) : null
  const askHref = `/knowledge?q=${encodeURIComponent(`About “${v.title}”: `)}`

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: 'Department', value: <Link href={`/knowledge/browse/${dept.id}`} className="hover:underline">{dept.name}</Link> },
    { label: 'Topic', value: topic?.name ?? <span className="text-gray-400">Unsorted</span> },
    { label: 'Type', value: ITEM_TYPE_LABELS[item.type] },
    {
      label: 'Guardian',
      value: guardianName ? (
        <span className="inline-flex items-center gap-1.5">
          <Avatar name={guardianName} size="xs" /> {guardianName}
        </span>
      ) : (
        <span className="text-gray-400">Not assigned</span>
      ),
    },
    {
      label: 'Last updated',
      value: item.last_published_at ? (
        <span title={formatDayMonthYear(item.last_published_at)}>{timeAgo(item.last_published_at)}</span>
      ) : (
        '—'
      ),
    },
    { label: 'Version', value: `v${v.version_number}` },
    ...(item.type === 'document'
      ? [{ label: 'File', value: <span className="break-all">{[v.file_name, formatBytes(v.file_size)].filter(Boolean).join(' · ')}</span> }]
      : []),
  ]

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <KnowledgeHeader ctx={ctx} active="browse" adminBar={false} />
        <Breadcrumbs
          items={[
            { label: 'Browse', href: '/knowledge/browse' },
            { label: dept.name, href: `/knowledge/browse/${dept.id}` },
            { label: v.title },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <article className="min-w-0 rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-2.5">
                <TypeTile type={item.type} size="sm" example={item.is_example} />
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                  {ITEM_TYPE_LABELS[item.type]}
                  {topic?.name ? ` · ${topic.name}` : ''}
                </p>
              </div>
              <h2 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-gray-900">{v.title}</h2>
              {v.description && <p className="mt-2 max-w-2xl text-[15px] leading-7 text-gray-600">{v.description}</p>}
              {item.is_example && (
                <div className="mt-3">
                  <ExampleBadge />
                </div>
              )}
            </div>

            <div className="border-t border-[#eceae5] px-6 py-6 sm:px-8 sm:py-8">
              {article && (
                <div className="kb-article prose-research max-w-3xl text-gray-800" dangerouslySetInnerHTML={{ __html: article.html }} />
              )}

              {(item.type === 'video' || item.type === 'link') && (
                <div className="flex flex-col gap-4 rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <TypeTile type={item.type} size="lg" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{item.type === 'video' ? 'Training video' : 'External resource'}</p>
                      <p className="truncate text-xs text-gray-500">{host ?? v.url ?? 'No link set'}</p>
                    </div>
                  </div>
                  {external && (
                    <a
                      href={v.url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900"
                    >
                      <ExternalLink size={14} /> {item.type === 'video' ? 'Watch video' : 'Open link'}
                    </a>
                  )}
                </div>
              )}

              {item.type === 'document' && (
                <>
                  <div className="flex flex-col gap-4 rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <TypeTile type="document" size="lg" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{v.file_name}</p>
                        <p className="text-xs text-gray-500">
                          {[formatBytes(v.file_size), approxWords(v.char_count), 'Fully searchable by the Knowledge Base'].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                    <a
                      href={`/api/knowledge/items/${item.id}/download`}
                      className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900"
                    >
                      <Download size={14} /> Download
                    </a>
                  </div>
                  {v.extracted_text && (
                    <div className="mt-6">
                      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                        <FileText size={11} /> Text preview
                        {v.extracted_text.length > PREVIEW_CHARS && <span className="font-medium normal-case tracking-normal text-gray-400">· first {PREVIEW_CHARS.toLocaleString('en-US')} characters</span>}
                      </p>
                      <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#eceae5] bg-[#fcfbf9] p-5 font-sans text-[13px] leading-relaxed text-gray-700">
                        {v.extracted_text.slice(0, PREVIEW_CHARS)}
                        {v.extracted_text.length > PREVIEW_CHARS ? '\n\n… Download the file for the full document.' : ''}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </article>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-[#e5e3df] bg-white p-4 shadow-sm">
              <Link
                href={askHref}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900"
              >
                <MessageCircleQuestion size={15} /> Ask about this
              </Link>
              <div className="mt-2">
                <SuggestButton
                  target={{ mode: 'suggest-change', itemId: item.id, itemTitle: v.title, departmentId: dept.id }}
                  departments={[{ id: dept.id, name: dept.name }]}
                  block
                />
              </div>
              <p className="mt-3 text-[11px] leading-4 text-gray-400">Spotted something out of date? Suggestions go to the department’s Guardian.</p>
            </div>

            <div className="rounded-2xl border border-[#e5e3df] bg-white p-4 shadow-sm">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">About this item</p>
              <dl className="flex flex-col gap-2.5 text-[13px]">
                {facts.map((f) => (
                  <div key={f.label} className="flex items-start justify-between gap-3">
                    <dt className="flex-shrink-0 text-gray-500">{f.label}</dt>
                    <dd className="min-w-0 text-right font-medium text-gray-800">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {article && article.toc.length > 1 && (
              <div className="rounded-2xl border border-[#e5e3df] bg-white p-4 shadow-sm">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">On this page</p>
                <ul className="flex flex-col gap-0.5">
                  {article.toc.map((t) => (
                    <li key={t.id}>
                      <a
                        href={`#${t.id}`}
                        className={`block truncate rounded-md px-2 py-1 text-[13px] text-gray-600 transition-colors hover:bg-[#faf9f7] hover:text-gray-900 ${t.level === 3 ? 'pl-5 text-xs' : ''}`}
                      >
                        {t.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
