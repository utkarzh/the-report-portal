export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbPageContext } from '@/lib/knowledge/page-context'
import { departmentForManagement, displayName } from '@/lib/knowledge/access'
import { LEAN_VERSION_COLUMNS } from '@/lib/knowledge/manage-data'
import KnowledgeNav from '@/components/knowledge/KnowledgeNav'
import ItemEditor, { type VersionSummary } from '@/components/knowledge/ItemEditor'
import type { KnowledgeItem, KnowledgeItemVersion, KnowledgeTopic } from '@/types'

type LeanVersion = Omit<KnowledgeItemVersion, 'extracted_text'>

export default async function KnowledgeItemEditorPage({ params }: { params: { deptId: string; itemId: string } }) {
  const ctx = await getKbPageContext()
  const managed = await departmentForManagement(ctx.actor, params.deptId)
  if (!managed) notFound()
  const { department, canEdit } = managed

  const { data: itemRow } = await supabaseAdmin.from('knowledge_items').select('*').eq('id', params.itemId).maybeSingle()
  const item = itemRow as KnowledgeItem | null
  if (!item || item.department_id !== department.id) notFound()

  // Text guides need their markdown body; documents never load extracted text here.
  const columns = `${LEAN_VERSION_COLUMNS}, content`
  const [{ data: versionRows }, { data: topics }, { count: openFeedback }] = await Promise.all([
    supabaseAdmin.from('knowledge_item_versions').select(columns).eq('item_id', item.id).order('version_number', { ascending: false }),
    supabaseAdmin.from('knowledge_topics').select('*').eq('department_id', department.id).order('position').order('name'),
    supabaseAdmin.from('knowledge_feedback').select('id', { count: 'exact', head: true }).eq('item_id', item.id).eq('status', 'open'),
  ])
  const versions = ((versionRows || []) as unknown) as LeanVersion[]
  const publisherIds = Array.from(new Set(versions.map((v) => v.published_by).filter(Boolean))) as string[]
  const { data: publishers } = publisherIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', publisherIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] }
  const pubName = new Map((publishers || []).map((p) => [p.id, displayName(p)]))
  const numberById = new Map(versions.map((v) => [v.id, v.version_number]))

  const published = versions.find((v) => v.id === item.published_version_id) ?? null
  const draft = versions.find((v) => v.id === item.draft_version_id) ?? null
  const history: VersionSummary[] = versions.map((v) => ({
    id: v.id,
    version_number: v.version_number,
    title: v.title,
    published_at: v.published_at,
    published_by_name: v.published_by ? pubName.get(v.published_by) ?? null : null,
    created_at: v.created_at,
    restored_from_number: v.restored_from_version_id ? numberById.get(v.restored_from_version_id) ?? null : null,
  }))
  const basePath = `/knowledge/manage/${department.id}`

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <KnowledgeNav active="manage" showManage subtitle="Organise, write and publish your department’s knowledge, and review what users send you." />
        <Link href={basePath} className="mb-4 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black">
          <ArrowLeft size={13} /> {department.name}
        </Link>
        <ItemEditor
          key={`${draft?.id ?? 'none'}-${draft?.updated_at ?? ''}-${item.updated_at}`}
          item={item}
          departmentId={department.id}
          basePath={basePath}
          topics={(topics || []) as KnowledgeTopic[]}
          canEdit={canEdit}
          published={published}
          draft={draft}
          versions={history}
          openFeedback={openFeedback ?? 0}
        />
      </div>
    </div>
  )
}
