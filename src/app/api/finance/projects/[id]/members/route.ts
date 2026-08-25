import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin, grantFieldAccessIfNeeded } from '@/lib/finance-auth'

interface Params {
  params: { id: string }
}

// POST /api/finance/projects/[id]/members — finance admin adds a team member
// (brief B-02). The DB enforces "exactly one Director per project" via a
// partial unique index — a second director insert fails and surfaces here.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { userId, projectRole } = await request.json()
  if (!userId || (projectRole !== 'director' && projectRole !== 'sales_rep')) {
    return NextResponse.json({ error: 'A user and a valid project role are required.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('finance_project_members').insert({
    project_id: params.id,
    user_id: userId,
    project_role: projectRole,
    added_by: profile.id,
  })

  if (error) {
    const duplicateDirector = error.message.includes('idx_finance_one_director_per_project')
    if (duplicateDirector) {
      return NextResponse.json({ error: 'This project already has a Director — remove them first.' }, { status: 409 })
    }
    // Postgres unique-violation on (project_id, user_id) — the UI already
    // filters this out (see AddMemberModal's existingMemberUserIds), so this
    // is a re-validation backstop, not the primary defense.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This person is already on the project team.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Adding someone as Director/Sales Rep is what grants field access —
  // picked from the whole user base (see GET .../users), not a prior
  // manual "flag them for finance first" step.
  await grantFieldAccessIfNeeded(userId)

  return NextResponse.json({ success: true }, { status: 201 })
}

// DELETE /api/finance/projects/[id]/members?memberId=... — remove a member
// (brief B-02: "members can be added or removed later"). A Director can
// never be removed through this generic endpoint — a project must always
// have exactly one (enforced elsewhere by idx_finance_one_director_per_project),
// and swapping the accountable Director is a deliberate decision, not a
// side effect of a stray click on the same X button used for Sales Reps.
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error

  const memberId = request.nextUrl.searchParams.get('memberId')
  if (!memberId) return NextResponse.json({ error: 'memberId is required.' }, { status: 400 })

  const { data: member } = await supabaseAdmin
    .from('finance_project_members')
    .select('project_role')
    .eq('id', memberId)
    .eq('project_id', params.id)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (member.project_role === 'director') {
    return NextResponse.json(
      { error: 'A project must always have a Director. Add the replacement Director first, then remove this one.' },
      { status: 409 },
    )
  }

  const { error } = await supabaseAdmin
    .from('finance_project_members')
    .delete()
    .eq('id', memberId)
    .eq('project_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
