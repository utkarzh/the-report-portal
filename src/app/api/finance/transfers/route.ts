import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'

// GET /api/finance/transfers — every transfer, for the finance-admin transfers
// page. POST creates one (brief J-01: "move funds between a Director's
// projects ... reclassified into the receiving country's project and fully
// logged"). Both projects stay independent ledgers — a transfer is its own
// row, read by computeBalance as an extra in/out on each side. When the two
// projects' settlement currencies differ, `amount` (debited from the source,
// in its own currency) and `to_amount` (credited to the destination, in ITS
// own currency) diverge via the caller-supplied `exchangeRate` — see below.
export async function GET() {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error

  const { data, error } = await supabaseAdmin
    .from('finance_transfers')
    .select('*, from_project:finance_projects!finance_transfers_from_project_id_fkey(name, settlement_currency), to_project:finance_projects!finance_transfers_to_project_id_fkey(name, settlement_currency)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ transfers: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { fromProjectId, toProjectId, amount, exchangeRate, reason } = await request.json()
  if (!fromProjectId || !toProjectId || fromProjectId === toProjectId) {
    return NextResponse.json({ error: 'Two different projects are required.' }, { status: 400 })
  }
  const numAmount = Number(amount)
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number.' }, { status: 400 })
  }

  const { data: projects } = await supabaseAdmin
    .from('finance_projects')
    .select('id, settlement_currency')
    .in('id', [fromProjectId, toProjectId])
  if ((projects ?? []).length !== 2) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const from = projects!.find(p => p.id === fromProjectId)!
  const to = projects!.find(p => p.id === toProjectId)!

  // Same currency: 1:1, exactly as before. Different currency: the amount
  // debited from `from` (in its own currency) and credited to `to` (in ITS
  // own currency) diverge, so a real conversion rate is required rather than
  // punting to manual entries.
  let toAmount = numAmount
  let rate = 1
  if (from.settlement_currency !== to.settlement_currency) {
    rate = Number(exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json({ error: `An exchange rate is required to convert ${from.settlement_currency} to ${to.settlement_currency}.` }, { status: 400 })
    }
    toAmount = Math.round(numAmount * rate * 100) / 100
  }

  const { data: transfer, error } = await supabaseAdmin
    .from('finance_transfers')
    .insert({
      from_project_id: fromProjectId,
      to_project_id: toProjectId,
      amount: numAmount,
      to_amount: toAmount,
      exchange_rate: rate,
      reason: (reason || '').trim(),
      created_by: profile.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ transfer }, { status: 201 })
}
