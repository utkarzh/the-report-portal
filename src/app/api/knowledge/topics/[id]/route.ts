import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardian } from '@/lib/knowledge/access'
import type { KnowledgeTopic } from '@/types'

async function loadTopic(id: string): Promise<KnowledgeTopic | null> {
  const { data } = await supabaseAdmin.from('knowledge_topics').select('*').eq('id', id).maybeSingle()
  return (data as KnowledgeTopic) ?? null
}

// PATCH { name?, move?: 'up' | 'down' } — rename or reorder (US-101).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const topic = await loadTopic(params.id)
  if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
  const g = await requireGuardian(actor, topic.department_id)
  if (!g.department) return g.response

  const body = (await request.json().catch(() => ({}))) as { name?: string; move?: 'up' | 'down' }
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'Name can’t be empty.' }, { status: 400 })
    await supabaseAdmin.from('knowledge_topics').update({ name }).eq('id', topic.id)
  }
  if (body.move === 'up' || body.move === 'down') {
    // Normalise positions to 0..n-1 first, then swap with the neighbour.
    const { data: all } = await supabaseAdmin
      .from('knowledge_topics')
      .select('id, position, name')
      .eq('department_id', topic.department_id)
      .order('position')
      .order('name')
    const ids = (all || []).map((t) => t.id as string)
    const idx = ids.indexOf(topic.id)
    const swapWith = body.move === 'up' ? idx - 1 : idx + 1
    if (idx >= 0 && swapWith >= 0 && swapWith < ids.length) {
      ;[ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]]
    }
    await Promise.all(ids.map((id, position) => supabaseAdmin.from('knowledge_topics').update({ position }).eq('id', id)))
  }
  return NextResponse.json({ ok: true })
}

// DELETE — items in the topic become "Unsorted" (topic_id SET NULL), never lost.
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const topic = await loadTopic(params.id)
  if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
  const g = await requireGuardian(actor, topic.department_id)
  if (!g.department) return g.response
  const { error } = await supabaseAdmin.from('knowledge_topics').delete().eq('id', topic.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
