import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbAdmin } from '@/lib/knowledge/access'

// Department membership from the department page (US-099). The user-profile
// side (users/[userId]/departments) writes the very same rows.

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbAdmin()
  if (!actor) return response

  const body = (await request.json().catch(() => ({}))) as { userIds?: string[]; userId?: string }
  const userIds = Array.from(new Set([...(body.userIds || []), ...(body.userId ? [body.userId] : [])])).filter(Boolean)
  if (userIds.length === 0) return NextResponse.json({ error: 'Choose at least one user.' }, { status: 400 })

  const { data: dept } = await supabaseAdmin.from('knowledge_departments').select('id').eq('id', params.id).maybeSingle()
  if (!dept) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('knowledge_department_members')
    .upsert(
      userIds.map((user_id) => ({ department_id: params.id, user_id, added_by: actor.id })),
      { onConflict: 'department_id,user_id', ignoreDuplicates: true },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbAdmin()
  if (!actor) return response
  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  const { error } = await supabaseAdmin
    .from('knowledge_department_members')
    .delete()
    .eq('department_id', params.id)
    .eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
