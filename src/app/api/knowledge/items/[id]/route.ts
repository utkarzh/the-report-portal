import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardianForItem } from '@/lib/knowledge/access'

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
