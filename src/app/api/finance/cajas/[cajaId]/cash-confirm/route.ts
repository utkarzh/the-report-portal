import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { canTransition } from '@/lib/finance-caja'

interface Params { params: { cajaId: string } }

// POST /api/finance/cajas/[cajaId]/cash-confirm — brief F-02: the director
// confirms physical cash on hand before submitting; this is what unlocks
// submit (draft → ready).
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: caja } = await supabaseAdmin.from('finance_cajas').select('*').eq('id', params.cajaId).single()
  if (!caja) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!isFinanceAdmin(profile)) {
    const { data: membership } = await supabaseAdmin
      .from('finance_project_members')
      .select('project_role')
      .eq('project_id', caja.project_id)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (!membership || membership.project_role !== 'director') {
      return NextResponse.json({ error: 'Only the project Director can confirm cash on hand.' }, { status: 403 })
    }
  }

  const { amount } = await request.json()
  const numAmount = Number(amount)
  if (!Number.isFinite(numAmount) || numAmount < 0) {
    return NextResponse.json({ error: 'A valid cash amount is required.' }, { status: 400 })
  }

  const toStage = caja.stage === 'draft' && canTransition('draft', 'ready') ? 'ready' : caja.stage
  const { data: updated, error } = await supabaseAdmin
    .from('finance_cajas')
    .update({ cash_confirmed_amount: numAmount, cash_confirmed_at: new Date().toISOString(), cash_confirmed_by: profile.id, stage: toStage })
    .eq('id', params.cajaId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (toStage !== caja.stage) {
    await supabaseAdmin.from('finance_caja_events').insert({ caja_id: params.cajaId, from_stage: caja.stage, to_stage: toStage, actor_id: profile.id, comment: 'Cash on hand confirmed' })
  }

  return NextResponse.json({ caja: updated })
}
