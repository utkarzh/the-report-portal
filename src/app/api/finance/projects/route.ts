import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess, requireFinanceAdmin, grantFieldAccessIfNeeded } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { computeBalance } from '@/lib/finance'
import type { FinanceExpense, FinanceFunding, FinanceTransfer } from '@/types'

// GET /api/finance/projects — finance admins (and platform admins) see every
// project; field users see only projects they're a member of (brief B-03).
// Each project comes back with its computed balance already attached so the
// overview/my-projects screens don't need a second round trip.
export async function GET() {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  let projectIds: string[] | null = null
  if (!isFinanceAdmin(profile)) {
    const { data: memberships } = await supabaseAdmin
      .from('finance_project_members')
      .select('project_id')
      .eq('user_id', profile.id)
    projectIds = (memberships ?? []).map(m => m.project_id)
    if (projectIds.length === 0) return NextResponse.json({ projects: [] })
  }

  let query = supabaseAdmin
    .from('finance_projects')
    .select('*, finance_project_members(id, user_id, project_role, profiles!finance_project_members_user_id_fkey(full_name, email))')
    .order('created_at', { ascending: false })
  if (projectIds) query = query.in('id', projectIds)

  const { data: projects, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (projects ?? []).map(p => p.id)
  const { data: fundings } = await supabaseAdmin.from('finance_fundings').select('*').in('project_id', ids)
  const { data: expenses } = await supabaseAdmin.from('finance_expenses').select('*').in('project_id', ids)
  const { data: transfers } = await supabaseAdmin
    .from('finance_transfers')
    .select('*')
    .or(`from_project_id.in.(${ids.join(',') || 'null'}),to_project_id.in.(${ids.join(',') || 'null'})`)

  const enriched = (projects ?? []).map(p => {
    const pf = (fundings ?? []).filter((f: FinanceFunding) => f.project_id === p.id)
    const pe = (expenses ?? []).filter((e: FinanceExpense) => e.project_id === p.id)
    const tIn = (transfers ?? []).filter((t: FinanceTransfer) => t.to_project_id === p.id)
    const tOut = (transfers ?? []).filter((t: FinanceTransfer) => t.from_project_id === p.id)
    const pendingCount = pe.filter(e => e.status === 'pending').length
    return { ...p, ...computeBalance(pf, pe, tIn, tOut), pendingCount }
  })

  return NextResponse.json({ projects: enriched })
}

// POST /api/finance/projects — finance admin creates a project + assigns its
// one required Director in the same call (brief B-01/B-02).
export async function POST(request: NextRequest) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const body = await request.json()
  const { name, country, settlementCurrency, exchangeRate, mediaPublication, directorUserId, localCurrency, salesRepUserIds, aiRules } = body

  if (!name?.trim() || !country?.trim() || !directorUserId) {
    return NextResponse.json({ error: 'Name, country and a director are required.' }, { status: 400 })
  }
  if (settlementCurrency !== 'USD' && settlementCurrency !== 'EUR') {
    return NextResponse.json({ error: 'Settlement currency must be USD or EUR.' }, { status: 400 })
  }
  const rate = Number(exchangeRate)
  if (!Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json({ error: 'Exchange rate must be a positive number.' }, { status: 400 })
  }

  const { data: project, error } = await supabaseAdmin
    .from('finance_projects')
    .insert({
      name: name.trim(),
      country: country.trim(),
      settlement_currency: settlementCurrency,
      exchange_rate: rate,
      media_publication: (mediaPublication || '').trim(),
      local_currency: (localCurrency || '').trim().toUpperCase(),
      ai_rules: (aiRules || '').trim(),
      created_by: profile.id,
    })
    .select('*')
    .single()

  if (error || !project) return NextResponse.json({ error: error?.message || 'Failed to create project.' }, { status: 500 })

  const { error: memberError } = await supabaseAdmin.from('finance_project_members').insert({
    project_id: project.id,
    user_id: directorUserId,
    project_role: 'director',
    added_by: profile.id,
  })

  if (memberError) {
    // Roll back the project so we never leave a director-less project behind
    // (brief B-02: "exactly one Director per project").
    await supabaseAdmin.from('finance_projects').delete().eq('id', project.id)
    return NextResponse.json({ error: 'Failed to assign the director. Please try again.' }, { status: 500 })
  }

  // The Director is picked from the whole user base (see GET .../users) —
  // being added here is what grants field access, not a prior manual step.
  await grantFieldAccessIfNeeded(directorUserId)

  // Optional sales reps added in the same step (brief B-02: admin can add
  // multiple users and assign roles during creation, not just afterward).
  // Best-effort — a bad id here shouldn't roll back the whole project.
  const repIds: string[] = Array.isArray(salesRepUserIds) ? salesRepUserIds.filter((id: unknown) => typeof id === 'string' && id) : []
  for (const repId of repIds) {
    if (repId === directorUserId) continue
    const { error: repError } = await supabaseAdmin.from('finance_project_members').insert({
      project_id: project.id,
      user_id: repId,
      project_role: 'sales_rep',
      added_by: profile.id,
    })
    if (!repError) await grantFieldAccessIfNeeded(repId)
  }

  return NextResponse.json({ project }, { status: 201 })
}
