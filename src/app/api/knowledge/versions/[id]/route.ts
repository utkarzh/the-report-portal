import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor } from '@/lib/knowledge/access'
import { VersionDeleteRefused, deleteKnowledgeVersion, requireKbDeleter } from '@/lib/knowledge/delete'

// DELETE /api/knowledge/versions/[id] — delete one old version of an item.
// Same people who may delete items: the department's Guardian or an admin.
// Never the live or the draft version (409).
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const { data: version } = await supabaseAdmin.from('knowledge_item_versions').select('item_id').eq('id', params.id).maybeSingle()
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  const { data: item } = await supabaseAdmin.from('knowledge_items').select('department_id').eq('id', version.item_id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  const d = await requireKbDeleter(actor, item.department_id)
  if (!d.department) return d.response
  try {
    const result = await deleteKnowledgeVersion(params.id)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    if (err instanceof VersionDeleteRefused) return NextResponse.json({ error: err.message }, { status: 409 })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not delete the version' }, { status: 500 })
  }
}
