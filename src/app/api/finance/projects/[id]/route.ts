import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess, requireFinanceAdmin } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { computeBalance, spendByCategory } from '@/lib/finance'

interface Params {
  params: { id: string }
}

// GET /api/finance/projects/[id] — full detail for the field project
// dashboard and the finance-admin project page: project row, team, funding
// ledger, expenses and the computed balance/category breakdown.
export async function GET(request: Request, { params }: Params) {
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

  const { data: project, error } = await supabaseAdmin
    .from('finance_projects')
    .select('*')
    .eq('id', params.id)
    .single()
  if (error || !project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: members } = await supabaseAdmin
    .from('finance_project_members')
    .select('id, user_id, project_role, created_at, profiles!finance_project_members_user_id_fkey(full_name, email)')
    .eq('project_id', params.id)
    .order('project_role')

  const { data: fundings } = await supabaseAdmin
    .from('finance_fundings')
    .select('*, profiles!finance_fundings_recorded_by_fkey(full_name, email)')
    .eq('project_id', params.id)
    .order('date_sent', { ascending: true })

  const { data: rawExpenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('*, finance_expense_flags(*), finance_receipts(file_path)')
    .eq('project_id', params.id)
    .order('expense_date', { ascending: false })

  // Signed URLs so the ledger can show the receipt beside each line without
  // a second round trip per row.
  const expenses = await Promise.all((rawExpenses ?? []).map(async (e) => {
    const path = e.finance_receipts?.file_path || e.receipt_file_path
    if (!path) return { ...e, receiptUrl: null }
    const { data: signed } = await supabaseAdmin.storage.from('finance-receipts').createSignedUrl(path, 3600)
    return { ...e, receiptUrl: signed?.signedUrl ?? null }
  }))

  const { data: transfersIn } = await supabaseAdmin.from('finance_transfers').select('*').eq('to_project_id', params.id)
  const { data: transfersOut } = await supabaseAdmin.from('finance_transfers').select('*').eq('from_project_id', params.id)

  return NextResponse.json({
    project,
    members: members ?? [],
    fundings: fundings ?? [],
    expenses,
    transfersIn: transfersIn ?? [],
    transfersOut: transfersOut ?? [],
    ...computeBalance(fundings ?? [], expenses, transfersIn ?? [], transfersOut ?? []),
    categorySpend: spendByCategory(expenses),
  })
}

// PATCH /api/finance/projects/[id] — finance admin updates the project's
// default exchange rate (brief B-01: "exchange rate (editable)") and/or its
// AI checking rules. Rate changes only affect expenses logged from now on —
// every already-logged expense keeps its own snapshotted exchange_rate_used
// (see expenses/route.ts), so past receipts are never retroactively
// recomputed, matching the brief's rule that a director's chosen rate at the
// time is preserved, not overridden. AI rules changes only affect receipts
// extracted/verified from now on — past ai_note/flags are not rewritten.
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error

  const { exchangeRate, aiRules } = await request.json()
  const update: Record<string, unknown> = {}

  if (exchangeRate !== undefined) {
    const rate = Number(exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json({ error: 'Exchange rate must be a positive number.' }, { status: 400 })
    }
    update.exchange_rate = rate
  }

  if (aiRules !== undefined) {
    update.ai_rules = String(aiRules).trim()
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { data: project, error } = await supabaseAdmin
    .from('finance_projects')
    .update(update)
    .eq('id', params.id)
    .select('*')
    .single()

  if (error || !project) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })
  return NextResponse.json({ project })
}
