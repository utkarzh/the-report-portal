import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardianForItem } from '@/lib/knowledge/access'
import { deleteKnowledgeItems, requireKbDeleter } from '@/lib/knowledge/delete'

// PATCH /api/knowledge/items/[id] — { topicId?, isExample? }
// Organisation metadata (US-101), applied straight away: moving an item
// between topics or marking it an "Example of excellent work" changes how it's
// filed, not what it says — content edits always go through a draft.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const g = await requireGuardianForItem(actor, params.id)
  if (!g.item) return g.response

  const body = (await request.json().catch(() => ({}))) as { topicId?: string | null; isExample?: boolean }
  const updates: Record<string, unknown> = {}
  if (body.topicId !== undefined) {
    if (body.topicId) {
      const { data: topic } = await supabaseAdmin.from('knowledge_topics').select('department_id').eq('id', body.topicId).maybeSingle()
      if (!topic || topic.department_id !== g.item.department_id) {
        return NextResponse.json({ error: 'That topic belongs to another department.' }, { status: 400 })
      }
    }
    updates.topic_id = body.topicId || null
  }
  if (body.isExample !== undefined) updates.is_example = !!body.isExample
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('knowledge_items').update(updates).eq('id', params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

// DELETE /api/knowledge/items/[id] — removes the item for good, published or
// not: its versions, search passages and uploaded file (deleteKnowledgeItems).
// The department's Guardian or a platform admin.
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const { data: item } = await supabaseAdmin.from('knowledge_items').select('id, department_id').eq('id', params.id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  const d = await requireKbDeleter(actor, item.department_id)
  if (!d.department) return d.response
  try {
    const result = await deleteKnowledgeItems(item.department_id, [item.id])
    return NextResponse.json({ ...result, ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not delete the item' }, { status: 500 })
  }
}
