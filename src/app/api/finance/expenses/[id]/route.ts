import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { categoryMismatchFlag } from '@/lib/finance-flags'
import type { FinanceExpenseCategory } from '@/types'

interface Params { params: { id: string } }

// Re-evaluates the category ↔ description sanity check against whatever the
// expense looks like AFTER an edit (admin correction or field resubmit) —
// clears any stale unresolved verdict first so a fixed mismatch doesn't
// linger, then re-flags if the new values still don't line up.
async function refreshCategoryMismatchFlag(expenseId: string, category: FinanceExpenseCategory, concept: string, vendor: string | null) {
  await supabaseAdmin.from('finance_expense_flags')
    .delete()
    .eq('expense_id', expenseId)
    .eq('flag_type', 'category_mismatch')
    .eq('resolved', false)
  const flags = categoryMismatchFlag(category, concept, vendor)
  if (flags.length > 0) {
    await supabaseAdmin.from('finance_expense_flags').insert(
      flags.map(f => ({ expense_id: expenseId, flag_type: f.flagType, severity: f.severity, message: f.message })),
    )
  }
}

// PATCH /api/finance/expenses/[id] — three distinct actions, disambiguated by
// which fields are sent:
//   - Field user editing + resubmitting a rejected expense (brief D-06): only
//     the original logger, only while status === 'rejected'. Resets to pending.
//   - Finance admin granting prior approval on an "Other Services" item
//     (mockup's "Request approval" flow) — resolves that flag.
//   - Finance admin adding a manual annotation flag (brief E-04).
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: expense } = await supabaseAdmin.from('finance_expenses').select('*').eq('id', params.id).single()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json()
  const admin = isFinanceAdmin(profile)

  if (body.grantPriorApproval) {
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await supabaseAdmin.from('finance_expense_flags')
      .update({ resolved: true })
      .eq('expense_id', params.id)
      .eq('flag_type', 'prior_approval_required')
    const { data, error } = await supabaseAdmin
      .from('finance_expenses')
      .update({ prior_approval_granted: true })
      .eq('id', params.id)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ expense: data })
  }

  if (body.manualNote) {
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { error } = await supabaseAdmin.from('finance_expense_flags').insert({
      expense_id: params.id,
      flag_type: 'manual_note',
      severity: 'info',
      message: String(body.manualNote).trim(),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // Finance admin correcting a logged expense directly from the dashboard —
  // any status, any field owner. Unlike the field user's "fix & resubmit"
  // flow below, this is a correction the admin is making themselves, not a
  // resubmission for review, so status/reviewed_* are left untouched.
  if (body.adminEdit) {
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const updates: Record<string, unknown> = {}
    for (const [key, column] of [
      ['concept', 'concept'], ['category', 'category'], ['subLine', 'sub_line'], ['date', 'expense_date'],
      ['reference', 'reference'], ['vendor', 'vendor'], ['localAmount', 'local_amount'],
      ['localCurrency', 'local_currency'], ['exchangeRate', 'exchange_rate_used'],
      ['settlementAmount', 'settlement_amount'], ['nights', 'nights'],
    ] as const) {
      if (body[key] !== undefined) updates[column] = body[key]
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

    const { data, error } = await supabaseAdmin.from('finance_expenses').update(updates).eq('id', params.id).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await refreshCategoryMismatchFlag(data.id, data.category, data.concept, data.vendor)
    return NextResponse.json({ expense: data })
  }

  // Edit + resubmit — the original logger only, only while rejected.
  if (expense.logged_by !== profile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (expense.status !== 'rejected') return NextResponse.json({ error: 'Only a rejected expense can be edited and resubmitted.' }, { status: 409 })

  const updates: Record<string, unknown> = { status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null }
  for (const [key, column] of [
    ['concept', 'concept'], ['category', 'category'], ['date', 'expense_date'],
    ['reference', 'reference'], ['vendor', 'vendor'], ['localAmount', 'local_amount'],
    ['localCurrency', 'local_currency'], ['settlementAmount', 'settlement_amount'], ['nights', 'nights'],
  ] as const) {
    if (body[key] !== undefined) updates[column] = body[key]
  }

  const { data, error } = await supabaseAdmin.from('finance_expenses').update(updates).eq('id', params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await refreshCategoryMismatchFlag(data.id, data.category, data.concept, data.vendor)
  return NextResponse.json({ expense: data })
}

// DELETE /api/finance/expenses/[id] — "Withdraw" (mockup): the original
// logger can withdraw their own expense only while it's still rejected —
// never a pending or verified one, so nothing already reviewed disappears.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: expense } = await supabaseAdmin.from('finance_expenses').select('logged_by, status').eq('id', params.id).single()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (expense.logged_by !== profile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (expense.status !== 'rejected') return NextResponse.json({ error: 'Only a rejected expense can be withdrawn.' }, { status: 409 })

  const { error } = await supabaseAdmin.from('finance_expenses').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
