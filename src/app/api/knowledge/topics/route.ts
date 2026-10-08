import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardian } from '@/lib/knowledge/access'

// POST /api/knowledge/topics — Guardian adds a topic (US-101).
export async function POST(request: NextRequest) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const body = (await request.json().catch(() => ({}))) as { departmentId?: string; name?: string }
  const name = (body.name || '').trim()
  if (!body.departmentId || !name) return NextResponse.json({ error: 'Give the topic a name.' }, { status: 400 })

  const g = await requireGuardian(actor, body.departmentId)
  if (!g.department) return g.response

  const { data: last } = await supabaseAdmin
    .from('knowledge_topics')
    .select('position')
    .eq('department_id', body.departmentId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabaseAdmin
    .from('knowledge_topics')
    .insert({ department_id: body.departmentId, name, position: (last?.position ?? -1) + 1 })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ topic: data })
}
