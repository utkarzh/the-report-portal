import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbAdmin } from '@/lib/knowledge/access'

// Department membership from the user's profile (US-099) — same rows as the
// department page edits.

export async function GET(_request: NextRequest, { params }: { params: { userId: string } }) {
  const { actor, response } = await getKbAdmin()
  if (!actor) return response
  const [{ data: departments }, { data: memberships }] = await Promise.all([
    supabaseAdmin.from('knowledge_departments').select('id, name, guardian_id, archived_at').order('name'),
    supabaseAdmin.from('knowledge_department_members').select('department_id').eq('user_id', params.userId),
  ])
  return NextResponse.json({
    departments: departments || [],
    memberIds: (memberships || []).map((m) => m.department_id),
  })
}

// PUT { departmentIds } — makes the user's memberships exactly this set.
export async function PUT(request: NextRequest, { params }: { params: { userId: string } }) {
  const { actor, response } = await getKbAdmin()
  if (!actor) return response
  const body = (await request.json().catch(() => ({}))) as { departmentIds?: string[] }
  const wanted = new Set((body.departmentIds || []).filter((x) => typeof x === 'string'))

  const { data: current } = await supabaseAdmin
    .from('knowledge_department_members')
    .select('department_id')
    .eq('user_id', params.userId)
  const have = new Set((current || []).map((m) => m.department_id as string))

  const toAdd = Array.from(wanted).filter((d) => !have.has(d))
  const toRemove = Array.from(have).filter((d) => !wanted.has(d))
  if (toAdd.length) {
    const { error } = await supabaseAdmin
      .from('knowledge_department_members')
      .upsert(toAdd.map((department_id) => ({ department_id, user_id: params.userId, added_by: actor.id })), {
        onConflict: 'department_id,user_id',
        ignoreDuplicates: true,
      })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (toRemove.length) {
    const { error } = await supabaseAdmin
      .from('knowledge_department_members')
      .delete()
      .eq('user_id', params.userId)
      .in('department_id', toRemove)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
