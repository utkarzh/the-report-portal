import { NextRequest, NextResponse } from 'next/server'
import { getKbActor } from '@/lib/knowledge/access'
import { deleteKnowledgeItems, requireKbDeleter } from '@/lib/knowledge/delete'

const MAX_ITEMS = 200

// POST /api/knowledge/items/delete — { departmentId, ids }: deletes the
// selected items of one department for good (the content list's "Delete
// selected"). The department's Guardian or a platform admin. Ids that aren't
// in that department are ignored.
export async function POST(request: NextRequest) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const body = (await request.json().catch(() => ({}))) as { departmentId?: unknown; ids?: unknown }
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId : ''
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string').slice(0, MAX_ITEMS) : []
  if (!departmentId || ids.length === 0) return NextResponse.json({ error: 'Choose at least one item to delete.' }, { status: 400 })

  const d = await requireKbDeleter(actor, departmentId)
  if (!d.department) return d.response
  try {
    const result = await deleteKnowledgeItems(departmentId, ids)
    return NextResponse.json({ ...result, ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not delete the items' }, { status: 500 })
  }
}
