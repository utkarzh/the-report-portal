import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { computeBalance } from '@/lib/finance'

interface Params { params: { cajaId: string } }

async function loadCajaWithAccessCheck(cajaId: string, userId: string, admin: boolean) {
  const { data: caja } = await supabaseAdmin.from('finance_cajas').select('*').eq('id', cajaId).single()
  if (!caja) return null
  if (!admin) {
    const { data: membership } = await supabaseAdmin
      .from('finance_project_members')
      .select('id')
      .eq('project_id', caja.project_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!membership) return null
  }
  return caja
}

// GET /api/finance/cajas/[cajaId] — the week's expenses (matched by date
// range, brief F-01), unresolved flags, incidents, and the audit-trail
// events, plus the computed balance the cash-count is reconciled against
// (brief F-02/F-03).
export async function GET(_request: Request, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth
  const admin = isFinanceAdmin(profile)

  const caja = await loadCajaWithAccessCheck(params.cajaId, profile.id, admin)
  if (!caja) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: rawExpenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('*, finance_expense_flags(*), profiles!finance_expenses_logged_by_fkey(full_name, email), finance_receipts(file_path)')
    .eq('project_id', caja.project_id)
    .gte('expense_date', caja.week_start)
    .lte('expense_date', caja.week_end)
    .order('expense_date')

  // Signed URLs so Finance can check the receipt beside the ticket on this
  // same page, in the one sitting — no separate review-queue visit needed.
  const expenses = await Promise.all((rawExpenses ?? []).map(async (e) => {
    const path = e.finance_receipts?.file_path || e.receipt_file_path
    if (!path) return { ...e, receiptUrl: null }
    const { data: signed } = await supabaseAdmin.storage.from('finance-receipts').createSignedUrl(path, 3600)
    return { ...e, receiptUrl: signed?.signedUrl ?? null }
  }))

  const { data: fundings } = await supabaseAdmin
    .from('finance_fundings')
    .select('*')
    .eq('project_id', caja.project_id)
    .lte('date_sent', caja.week_end)

  const { data: allExpensesToDate } = await supabaseAdmin
    .from('finance_expenses')
    .select('settlement_amount, status')
    .eq('project_id', caja.project_id)
    .lte('expense_date', caja.week_end)

  const { data: transfersIn } = await supabaseAdmin
    .from('finance_transfers').select('amount').eq('to_project_id', caja.project_id).lte('created_at', `${caja.week_end}T23:59:59`)
  const { data: transfersOut } = await supabaseAdmin
    .from('finance_transfers').select('amount').eq('from_project_id', caja.project_id).lte('created_at', `${caja.week_end}T23:59:59`)

  const { balance } = computeBalance(fundings ?? [], allExpensesToDate ?? [], transfersIn ?? [], transfersOut ?? [])

  const { data: incidents } = await supabaseAdmin
    .from('finance_incidents')
    .select('*, finance_incident_messages(*, profiles(full_name, email))')
    .eq('caja_id', caja.id)
    .order('created_at')

  const { data: events } = await supabaseAdmin
    .from('finance_caja_events')
    .select('*, profiles(full_name, email)')
    .eq('caja_id', caja.id)
    .order('created_at')

  return NextResponse.json({
    caja,
    expenses: expenses ?? [],
    incidents: incidents ?? [],
    events: events ?? [],
    computedBalance: balance,
    isFinanceAdmin: admin,
  })
}
