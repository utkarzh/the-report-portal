import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'

interface Params { params: { id: string } }

// GET/POST /api/finance/projects/[id]/cajas — the weekly caja list + creation
// (brief F-01). A director or finance admin can open a new week; expenses
// are matched into it by date range at read time (see .../cajas/[cajaId]),
// not by backfilling caja_id, so a caja can be opened any time without a
// migration step to reconcile already-logged expenses.
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  if (!isFinanceAdmin(profile)) {
    const { data: membership } = await supabaseAdmin
      .from('finance_project_members')
      .select('id')
      .eq('project_id', params.id)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin
    .from('finance_cajas')
    .select('*')
    .eq('project_id', params.id)
    .order('week_number', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cajas: data ?? [] })
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  if (!isFinanceAdmin(profile)) {
    const { data: membership } = await supabaseAdmin
      .from('finance_project_members')
      .select('id')
      .eq('project_id', params.id)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { weekNumber, weekStart, weekEnd } = await request.json()
  if (!weekNumber || !weekStart || !weekEnd) {
    return NextResponse.json({ error: 'weekNumber, weekStart and weekEnd are required.' }, { status: 400 })
  }

  const { data: caja, error } = await supabaseAdmin
    .from('finance_cajas')
    .insert({ project_id: params.id, week_number: weekNumber, week_start: weekStart, week_end: weekEnd })
    .select('*')
    .single()

  if (error) {
    const duplicate = error.message.includes('finance_cajas_project_id_week_number_key')
    return NextResponse.json({ error: duplicate ? 'A caja for this week already exists.' : error.message }, { status: duplicate ? 409 : 500 })
  }

  await supabaseAdmin.from('finance_caja_events').insert({ caja_id: caja.id, from_stage: null, to_stage: 'draft', actor_id: profile.id })

  return NextResponse.json({ caja }, { status: 201 })
}
