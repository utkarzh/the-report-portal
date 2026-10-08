import { supabaseAdmin } from '@/lib/supabase/admin'
import type { KnowledgeItem, KnowledgeItemVersion } from '@/types'

// Shared item/version helpers for the Guardian routes.

export async function loadVersion(id: string | null): Promise<KnowledgeItemVersion | null> {
  if (!id) return null
  const { data } = await supabaseAdmin.from('knowledge_item_versions').select('*').eq('id', id).maybeSingle()
  return (data as KnowledgeItemVersion) ?? null
}

export async function nextVersionNumber(itemId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('knowledge_item_versions')
    .select('version_number')
    .eq('item_id', itemId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.version_number ?? 0) + 1
}

// "Editing a published item creates a draft" (US-103): a copy of the live
// version that the Guardian edits while the published one stays live.
export async function ensureDraft(item: KnowledgeItem, userId: string): Promise<KnowledgeItemVersion> {
  const existing = await loadVersion(item.draft_version_id)
  if (existing) return existing
  const base = await loadVersion(item.published_version_id)
  if (!base) throw new Error('This item has no published version to edit.')
  const { data, error } = await supabaseAdmin
    .from('knowledge_item_versions')
    .insert({
      item_id: item.id,
      version_number: await nextVersionNumber(item.id),
      title: base.title,
      description: base.description,
      content: base.content,
      url: base.url,
      file_path: base.file_path,
      file_name: base.file_name,
      file_mime: base.file_mime,
      file_size: base.file_size,
      extracted_text: base.extracted_text,
      char_count: base.char_count,
      extraction_status: 'ready',
      created_by: userId,
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message || 'Could not create a draft')
  await supabaseAdmin.from('knowledge_items').update({ draft_version_id: data.id }).eq('id', item.id)
  return data as KnowledgeItemVersion
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || name
}
