import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin, grantFieldAccessIfNeeded } from '@/lib/finance-auth'

interface Params {
  params: { id: string }
}

// PATCH /api/finance/projects/[id]/director — the ONLY way to swap a
// project's Director. Removing a Director through the generic member
// endpoint is blocked on purpose (a project must always have exactly one,
// enforced by idx_finance_one_director_per_project) — this route does the
// remove-old/add-new swap atomically-ish, with a best-effort rollback if the
// new Director can't be inserted, so a bad request can't leave the project
// without one.
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { newDirectorUserId } = await request.json()
  if (!newDirectorUserId) return NextResponse.json({ error: 'A new director is required.' }, { status: 400 })

  const { data: newDirector } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status')
    .eq('id', newDirectorUserId)
    .single()
  if (!newDirector || newDirector.status !== 'active' || newDirector.role !== 'user') {
    return NextResponse.json({ error: 'The new director must be an active, non-admin team member.' }, { status: 400 })
  }

  const { data: currentDirector } = await supabaseAdmin
    .from('finance_project_members')
    .select('id, user_id')
    .eq('project_id', params.id)
    .eq('project_role', 'director')
    .maybeSingle()

  if (currentDirector?.user_id === newDirectorUserId) {
    return NextResponse.json({ error: 'This person is already the Director.' }, { status: 409 })
  }

  if (currentDirector) {
    await supabaseAdmin.from('finance_project_members').delete().eq('id', currentDirector.id)
  }

  const { error: insertError } = await supabaseAdmin.from('finance_project_members').insert({
    project_id: params.id,
    user_id: newDirectorUserId,
    project_role: 'director',
    added_by: profile.id,
  })

  if (insertError) {
    if (currentDirector) {
      await supabaseAdmin.from('finance_project_members').insert({
        project_id: params.id,
        user_id: currentDirector.user_id,
        project_role: 'director',
        added_by: profile.id,
      })
    }
    return NextResponse.json({ error: 'Failed to assign the new director. Nothing was changed.' }, { status: 500 })
  }

  await grantFieldAccessIfNeeded(newDirectorUserId)
  return NextResponse.json({ success: true })
}
