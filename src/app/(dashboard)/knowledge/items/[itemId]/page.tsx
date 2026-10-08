export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download, ExternalLink, Sparkles } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { displayName } from '@/lib/knowledge/access'
import { ITEM_TYPE_LABELS, formatBytes } from '@/lib/knowledge/constants'
import { renderKbMarkdown } from '@/lib/knowledge/markdown'
import { formatDayMonthYear } from '@/lib/date-format'
import KnowledgeNav from '@/components/knowledge/KnowledgeNav'
import ItemTypeIcon from '@/components/knowledge/ItemTypeIcon'
import SuggestButton from '@/components/knowledge/SuggestButton'
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

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-4xl mx-auto">
        <KnowledgeNav active="browse" showManage={ctx.showManage} />
        <Link href={`/knowledge/browse/${dept.id}`} className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black">
          <ArrowLeft size={13} /> {dept.name}
        </Link>

        <article className="mt-4 rounded-xl border border-[#e5e3df] bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-400">
                <ItemTypeIcon type={item.type} size={13} /> {ITEM_TYPE_LABELS[item.type]}
                {topic?.name ? ` · ${topic.name}` : ''}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-gray-900">{v.title}</h2>
              {item.is_example && (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#fbf7ed] px-2 py-0.5 text-[11px] font-medium text-[#a07530]">
                  <Sparkles size={11} /> Example of excellent work
                </span>
              )}
              <p className="mt-2 text-xs text-gray-500">
                {dept.name} · Guardian: {displayName(guardian) ?? 'not assigned'}
                {item.last_published_at ? ` · Last updated ${formatDayMonthYear(item.last_published_at)}` : ''}
              </p>
            </div>
            <SuggestButton
              target={{ mode: 'suggest-change', itemId: item.id, itemTitle: v.title, departmentId: dept.id }}
              departments={[{ id: dept.id, name: dept.name }]}
            />
          </div>

          {v.description && <p className="mt-5 text-sm text-gray-600">{v.description}</p>}

          <div className="mt-6 border-t border-[#f0efec] pt-6">
            {item.type === 'text' && (
              <div className="prose-research text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: renderKbMarkdown(v.content) }} />
            )}

            {(item.type === 'video' || item.type === 'link') && v.url && (
              <a
                href={v.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-black px-5 py-3 text-xs font-medium uppercase tracking-wider text-white hover:bg-gray-900"
              >
                <ExternalLink size={14} /> {item.type === 'video' ? 'Watch video' : 'Open link'}
              </a>
            )}

            {item.type === 'document' && (
              <>
                <a
                  href={`/api/knowledge/items/${item.id}/download`}
                  className="inline-flex items-center gap-2 rounded-xl bg-black px-5 py-3 text-xs font-medium uppercase tracking-wider text-white hover:bg-gray-900"
                >
                  <Download size={14} /> Download {v.file_name}
                </a>
                <p className="mt-2 text-[11px] text-gray-400">
                  {formatBytes(v.file_size)}
                  {v.char_count ? ` · ${v.char_count.toLocaleString('en-US')} characters` : ''}
                </p>
                {v.extracted_text && (
                  <details className="mt-6">
                    <summary className="cursor-pointer text-xs font-medium text-gray-600 hover:text-black">Preview text</summary>
                    <pre className="mt-3 max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#faf9f7] p-4 font-sans text-[13px] leading-relaxed text-gray-700">
                      {v.extracted_text.slice(0, PREVIEW_CHARS)}
                      {v.extracted_text.length > PREVIEW_CHARS ? '\n\n… (download the file for the full document)' : ''}
                    </pre>
                  </details>
                )}
              </>
            )}
          </div>
        </article>
      </div>
    </div>
  )
}
