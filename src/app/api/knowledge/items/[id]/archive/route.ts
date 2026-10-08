import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardianForItem } from '@/lib/knowledge/access'

// POST /api/knowledge/items/[id]/archive — { archive: boolean } (US-108).
// Archiving flips status, and knowledge_search() only ever returns
// status='published' items, so the item leaves browsing and answers for every
// user on their very next request. Its passages are kept, so restoring from
// the archive is instant. Past answers that cited it keep their snapshot.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const g = await requireGuardianForItem(actor, params.id)
  if (!g.item) return g.response

  const body = (await request.json().catch(() => ({}))) as { archive?: boolean }
  const archive = body.archive !== false
  const updates = archive
    ? { status: 'archived', archived_at: new Date().toISOString() }
    : { status: g.item.published_version_id ? 'published' : 'draft', archived_at: null }

  const { data, error } = await supabaseAdmin.from('knowledge_items').update(updates).eq('id', params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}
