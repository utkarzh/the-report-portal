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

  let filesRemoved = 0
  if (paths.length) {
    // A file another item still uses stays. A failed check keeps every file.
    const { data: stillUsed, error: checkError } = await supabaseAdmin.from('knowledge_item_versions').select('file_path').in('file_path', paths)
    if (!checkError) {
      const used = new Set((stillUsed || []).map((v) => v.file_path as string))
      const removable = paths.filter((p) => !used.has(p))
      if (removable.length) {
        const { data: removed, error: removeError } = await supabaseAdmin.storage.from(KNOWLEDGE_BUCKET).remove(removable)
        if (removeError) console.error('Knowledge Base: could not delete stored files:', removeError.message)
        filesRemoved = removed?.length ?? 0
      }
    } else {
      console.error('Knowledge Base: file reference check failed, kept the files:', checkError.message)
    }
  }
  return { deleted: count ?? ownedIds.length, filesRemoved }
}
