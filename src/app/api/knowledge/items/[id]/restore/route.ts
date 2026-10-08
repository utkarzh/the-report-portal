import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardianForItem } from '@/lib/knowledge/access'
import { loadVersion, nextVersionNumber } from '@/lib/knowledge/items'
import { resetVersionIndex } from '@/lib/knowledge/indexing'

// POST /api/knowledge/items/[id]/restore — { versionId } (US-105).
// Restoring an older published version never goes live by itself: it becomes
// the draft (replacing any current draft), to be reviewed and published.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const g = await requireGuardianForItem(actor, params.id)
  if (!g.item) return g.response
  const item = g.item
  if (item.status === 'archived') return NextResponse.json({ error: 'Restore this item from the archive first.' }, { status: 409 })

  const body = (await request.json().catch(() => ({}))) as { versionId?: string }
  const source = await loadVersion(body.versionId || null)
  if (!source || source.item_id !== item.id || !source.published_at) {
    return NextResponse.json({ error: 'Only previously published versions can be restored.' }, { status: 400 })
  }

  const fields = {
    title: source.title,
    description: source.description,
    content: source.content,
    url: source.url,
    file_path: source.file_path,
    file_name: source.file_name,
    file_mime: source.file_mime,
    file_size: source.file_size,
    extracted_text: source.extracted_text,
    char_count: source.char_count,
    extraction_status: 'ready',
    extraction_error: null,
    restored_from_version_id: source.id,
  }

  const draft = await loadVersion(item.draft_version_id)
  if (draft) {
    const { data, error } = await supabaseAdmin.from('knowledge_item_versions').update(fields).eq('id', draft.id).select('id').single()
    if (error || !data) return NextResponse.json({ error: error?.message || 'Restore failed' }, { status: 500 })
    await resetVersionIndex(draft.id)
    return NextResponse.json({ versionId: draft.id })
  }

  const { data, error } = await supabaseAdmin
    .from('knowledge_item_versions')
    .insert({ ...fields, item_id: item.id, version_number: await nextVersionNumber(item.id), created_by: actor.id })
    .select('id')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message || 'Restore failed' }, { status: 500 })
  await supabaseAdmin.from('knowledge_items').update({ draft_version_id: data.id }).eq('id', item.id)
  return NextResponse.json({ versionId: data.id })
}
