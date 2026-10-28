import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin, closedProjectError } from '@/lib/finance-auth'
import { recordHistory } from '@/lib/finance-history'
import { conversionBlocker } from '@/lib/finance-review'

interface Params { params: { id: string } }

// POST /api/finance/expenses/[id]/verify — brief E-03: verifying draws down
// the balance automatically. The balance itself is computed on read from
// status='verified' rows only (see computeBalance) — a pending expense
// doesn't count until this happens, so this action IS the first (and only)
// draw-down moment, not a formality on top of an already-deducted amount.
// Only a pending ticket can be verified (a rejected one goes back to pending
// through its uploader first), never on a closed project, and every
// verification is written to the history.
export async function POST(_request: Request, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: before } = await supabaseAdmin
    .from('finance_expenses')
    .select('project_id, status, local_amount, local_currency, settlement_amount, exchange_rate_used, finance_projects(settlement_currency)')
    .eq('id', params.id)
    .single<{ project_id: string; status: string; local_amount: number; local_currency: string; settlement_amount: number; exchange_rate_used: number; finance_projects: { settlement_currency: string } | null }>()
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const closed = await closedProjectError(before.project_id)
  if (closed) return closed
  if (before.status !== 'pending') return NextResponse.json({ error: `Only a pending ticket can be verified (this one is ${before.status}).` }, { status: 409 })
  if (before.finance_projects) {
    const blocked = await conversionBlocker(before, before.finance_projects.settlement_currency)
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin
    .from('finance_expenses')
    .update({ status: 'verified', reviewed_by: profile.id, reviewed_at: new Date().toISOString(), rejection_reason: null })
    .eq('id', params.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'This ticket was changed while you were reviewing it. Reload to see its current state.' }, { status: 409 })
  await recordHistory({
    projectId: data.project_id, entityType: 'expense', entityId: data.id, action: 'verified', actor: profile,
    changes: { status: { from: 'pending', to: 'verified' } },
  })
  return NextResponse.json({ expense: data })
}
