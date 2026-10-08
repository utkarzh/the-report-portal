import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardianForItem } from '@/lib/knowledge/access'
import { ensureDraft, isHttpUrl, loadVersion } from '@/lib/knowledge/items'
import { resetVersionIndex } from '@/lib/knowledge/indexing'
import { KNOWLEDGE_BUCKET, UPLOAD_EXT_RE } from '@/lib/knowledge/constants'

// POST — start editing a published item: creates the draft copy (US-103).
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const g = await requireGuardianForItem(actor, params.id)
  if (!g.item) return g.response
  if (g.item.status === 'archived') return NextResponse.json({ error: 'Restore this item from the archive first.' }, { status: 409 })
  try {
    const draft = await ensureDraft(g.item, actor.id)
    return NextResponse.json({ version: draft })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create a draft' }, { status: 500 })
  }
}

// PATCH — save the draft. { title?, description?, content?, url?, file? }
// Saving never touches the published version, so drafts never change what
// the AI says (US-105).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const g = await requireGuardianForItem(actor, params.id)
  if (!g.item) return g.response
  const item = g.item
  const draft = await loadVersion(item.draft_version_id)
  if (!draft) return NextResponse.json({ error: 'There is no draft to save. Click Edit first.' }, { status: 409 })

  const body = (await request.json().catch(() => ({}))) as {
    title?: string
    description?: string
    content?: string
    url?: string
    file?: { path?: string; name?: string; mime?: string | null; size?: number }
  }
  const updates: Record<string, unknown> = {}
  if (body.title !== undefined) {
    const title = body.title.trim()
    if (!title) return NextResponse.json({ error: 'Title can’t be empty.' }, { status: 400 })
    updates.title = title.slice(0, 200)
  }
  if (body.description !== undefined) updates.description = body.description.trim()
  if (body.content !== undefined && item.type === 'text') {
    updates.content = body.content
    updates.char_count = body.content.length
  }
  if (body.url !== undefined && (item.type === 'video' || item.type === 'link')) {
    const url = body.url.trim()
    if (!isHttpUrl(url)) return NextResponse.json({ error: 'Enter a full link starting with https://' }, { status: 400 })
    updates.url = url
  }
  // US-107: replacing an unreadable file with a readable version.
  if (body.file && item.type === 'document') {
    const f = body.file
    if (!f.path || !f.name || !f.path.startsWith(`${item.department_id}/items/`) || !UPLOAD_EXT_RE.test(f.name)) {
      return NextResponse.json({ error: 'Upload a PDF, Word (.docx) or plain text file.' }, { status: 400 })
    }
    Object.assign(updates, {
      file_path: f.path,
      file_name: f.name,
      file_mime: f.mime || null,
      file_size: f.size ?? null,
      extracted_text: null,
      char_count: 0,
      extraction_status: 'pending',
      extraction_error: null,
      extraction_started_at: null,
    })
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ version: draft })

  const { data: saved, error } = await supabaseAdmin
    .from('knowledge_item_versions')
    .update(updates)
    .eq('id', draft.id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Any change to indexable text invalidates passages from an interrupted
  // earlier publish attempt.
  if (draft.index_status !== 'not_indexed') await resetVersionIndex(draft.id)

  // Before the first publish, the item row mirrors the draft for lists.
  if (!item.published_version_id && (updates.title !== undefined || updates.description !== undefined)) {
    await supabaseAdmin
      .from('knowledge_items')
      .update({ title: saved.title, description: saved.description })
      .eq('id', item.id)
  }
  return NextResponse.json({ version: { ...saved, index_status: 'not_indexed', chunk_count: 0 } })
}

// DELETE — discard the draft. For an item that was never published this
// removes the item entirely (it never existed for users).
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const g = await requireGuardianForItem(actor, params.id)
  if (!g.item) return g.response
  const item = g.item

  if (!item.published_version_id) {
    const { data: versions } = await supabaseAdmin.from('knowledge_item_versions').select('file_path').eq('item_id', item.id)
    const paths = Array.from(new Set((versions || []).map((v) => v.file_path as string | null).filter(Boolean))) as string[]
    await supabaseAdmin.from('knowledge_items').delete().eq('id', item.id)
    if (paths.length) await supabaseAdmin.storage.from(KNOWLEDGE_BUCKET).remove(paths)
    return NextResponse.json({ deleted: true })
  }
  if (!item.draft_version_id) return NextResponse.json({ ok: true })
  await supabaseAdmin.from('knowledge_items').update({ draft_version_id: null }).eq('id', item.id)
  await supabaseAdmin.from('knowledge_item_versions').delete().eq('id', item.draft_version_id)
  return NextResponse.json({ ok: true })
}
