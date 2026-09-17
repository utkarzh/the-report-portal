import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'

interface Params { params: { id: string } }

// POST /api/finance/expenses/[id]/verify — brief E-03: verifying draws down
// the balance automatically. The balance itself is computed on read from
// status='verified' rows only (see computeBalance) — a pending expense
// doesn't count until this happens, so this action IS the first (and only)
// draw-down moment, not a formality on top of an already-deducted amount.
export async function POST(_request: Request, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data, error } = await supabaseAdmin
    .from('finance_expenses')
    .update({ status: 'verified', reviewed_by: profile.id, reviewed_at: new Date().toISOString(), rejection_reason: null })
    .eq('id', params.id)
    .select('*')
    .single()

  if (error || !data) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })
  return NextResponse.json({ expense: data })
}
