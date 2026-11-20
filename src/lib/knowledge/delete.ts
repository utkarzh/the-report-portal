import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { KNOWLEDGE_BUCKET } from '@/lib/knowledge/constants'
import type { KbActorRef } from '@/lib/knowledge/access'
import type { KnowledgeDepartment } from '@/types'

// Permanent deletion of knowledge items, published or not (10 Nov 2026: there
// was only Archive, and nineteen unwanted documents had to be removed by hand).
// Deleting an item removes its versions and search passages (ON DELETE
// CASCADE), so it leaves browsing and AI answers on the next request. Past
// answers that cited it keep their snapshot of the source. The uploaded files
// are then removed from storage, unless another item's version still points
// at the same file.

// Who may delete: the department's Guardian (while the department is live),
// and platform admins.
export async function requireKbDeleter(
  actor: KbActorRef,
  departmentId: string,
): Promise<{ department: KnowledgeDepartment; response?: undefined } | { department: null; response: NextResponse }> {
  const { data } = await supabaseAdmin.from('knowledge_departments').select('*').eq('id', departmentId).maybeSingle()
  if (!data) return { department: null, response: NextResponse.json({ error: 'Department not found' }, { status: 404 }) }
  const department = data as KnowledgeDepartment
  const isGuardian = department.guardian_id === actor.id && !department.archived_at
  if (!isGuardian && actor.role !== 'admin') {
    return { department: null, response: NextResponse.json({ error: 'Only this department’s Guardian or an admin can delete its knowledge.' }, { status: 403 }) }
  }
  return { department }
}

// Deletes these items of one department; ids from elsewhere are ignored.
export async function deleteKnowledgeItems(departmentId: string, itemIds: string[]): Promise<{ deleted: number; filesRemoved: number }> {
  const ids = Array.from(new Set(itemIds)).filter(Boolean)
  if (ids.length === 0) return { deleted: 0, filesRemoved: 0 }

  const { data: owned } = await supabaseAdmin.from('knowledge_items').select('id').in('id', ids).eq('department_id', departmentId)
  const ownedIds = (owned || []).map((r) => r.id as string)
  if (ownedIds.length === 0) return { deleted: 0, filesRemoved: 0 }

  const { data: versions } = await supabaseAdmin.from('knowledge_item_versions').select('file_path').in('item_id', ownedIds)
  const paths = Array.from(new Set((versions || []).map((v) => v.file_path as string | null).filter(Boolean))) as string[]

  const { error, count } = await supabaseAdmin.from('knowledge_items').delete({ count: 'exact' }).in('id', ownedIds).eq('department_id', departmentId)
  if (error) throw new Error(error.message)

  const filesRemoved = await removeUnusedKnowledgeFiles(paths)
  return { deleted: count ?? ownedIds.length, filesRemoved }
}

// Removes stored files no version uses any more. Versions copied from each
// other share one file, so each path is checked first: a file another
// version (of any item) still uses stays, and a failed check keeps every file.
async function removeUnusedKnowledgeFiles(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0
  const { data: stillUsed, error: checkError } = await supabaseAdmin.from('knowledge_item_versions').select('file_path').in('file_path', paths)
  if (checkError) {
    console.error('Knowledge Base: file reference check failed, kept the files:', checkError.message)
    return 0
  }
  const used = new Set((stillUsed || []).map((v) => v.file_path as string))
  const removable = paths.filter((p) => !used.has(p))
  if (removable.length === 0) return 0
  const { data: removed, error: removeError } = await supabaseAdmin.storage.from(KNOWLEDGE_BUCKET).remove(removable)
  if (removeError) console.error('Knowledge Base: could not delete stored files:', removeError.message)
  return removed?.length ?? 0
}

export class VersionDeleteRefused extends Error {}

// Deletes one old version of an item. The live and the draft version can
// never be deleted this way (publish, discard or delete the item instead).
// Its search passages go with it (FK cascade); a version restored from it
// keeps working (restored_from_version_id has no FK) and just shows that its
// source was deleted. Past answers keep their source snapshots.
export async function deleteKnowledgeVersion(versionId: string): Promise<{ filesRemoved: number }> {
  const { data: version } = await supabaseAdmin
    .from('knowledge_item_versions')
    .select('id, item_id, file_path')
    .eq('id', versionId)
    .maybeSingle()
  if (!version) throw new VersionDeleteRefused('That version no longer exists.')
  const { data: item } = await supabaseAdmin
    .from('knowledge_items')
    .select('published_version_id, draft_version_id')
    .eq('id', version.item_id)
    .maybeSingle()
  if (item?.published_version_id === versionId) throw new VersionDeleteRefused('The live version can’t be deleted. Publish another version first.')
  if (item?.draft_version_id === versionId) throw new VersionDeleteRefused('The current draft can’t be deleted here. Use Discard draft instead.')

  const { error } = await supabaseAdmin.from('knowledge_item_versions').delete().eq('id', versionId)
  if (error) throw new Error(error.message)
  const filesRemoved = await removeUnusedKnowledgeFiles(version.file_path ? [version.file_path as string] : [])
  return { filesRemoved }
}
