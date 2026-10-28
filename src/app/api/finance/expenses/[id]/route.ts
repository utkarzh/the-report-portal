import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess, closedProjectError } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { categoryMismatchFlag } from '@/lib/finance-flags'
import { reverifyExpense, refreshConversionFlags } from '@/lib/finance-review'
import { recordHistory, diffFields, EXPENSE_HISTORY_FIELDS } from '@/lib/finance-history'
import { addExpenseComment, notifyExpenseThread, MAX_COMMENT_LENGTH } from '@/lib/finance-comments'
import { removeUnusedFinanceFiles } from '@/lib/finance-attachments'
import { getBaseUrl } from '@/lib/url'
import { reconcileConversion } from '@/lib/finance'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpense, FinanceExpenseCategory } from '@/types'

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

// PATCH /api/finance/expenses/[id] — distinct actions, disambiguated by
// which fields are sent:
//   - Finance admin granting prior approval on an "Other Services" item
//     (mockup's "Request approval" flow) — resolves that flag.
//   - Finance admin adding a manual annotation flag (brief E-04).
//   - Finance admin correcting a ticket's values (adminEdit).
//   - Replacing the receipt photo behind one ticket.
//   - The original logger editing their own ticket: a correction while
//     pending, a fix & resubmit while rejected (brief D-06).
//
// A verified ticket is locked: none of its values or its photo can change,
// for Finance either (client decision, 26 Oct 2026) — only prior approval
// and notes, which don't touch the money. A closed project is read-only.
// Every change is written to the history (finance-history.ts).
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: expense } = await supabaseAdmin.from('finance_expenses').select('*').eq('id', params.id).single()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const closed = await closedProjectError(expense.project_id)
  if (closed) return closed

  const body = await request.json()
  const admin = isFinanceAdmin(profile)
  const history = (action: string, after: Record<string, unknown> | null, note?: string | null) => recordHistory({
    projectId: expense.project_id,
    entityType: 'expense',
    entityId: expense.id,
    action,
    actor: profile,
    changes: after ? diffFields(expense, after, EXPENSE_HISTORY_FIELDS) : {},
    note,
  })

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
    await history('prior_approval_granted', null)
    return NextResponse.json({ expense: data })
  }

  if (body.manualNote) {
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const note = String(body.manualNote).trim()
    const { error } = await supabaseAdmin.from('finance_expense_flags').insert({
      expense_id: params.id,
      flag_type: 'manual_note',
      severity: 'info',
      message: note,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await history('note_added', null, note)
    return NextResponse.json({ success: true })
  }

  if (expense.status === 'verified') {
    return NextResponse.json({ error: 'A verified ticket is locked and can no longer be changed.' }, { status: 409 })
  }

  const { data: project } = await supabaseAdmin
    .from('finance_projects')
    .select('exchange_rate, settlement_currency')
    .eq('id', expense.project_id)
    .single()

  // Finance admin correcting a not-yet-verified ticket directly from the
  // dashboard. Unlike the field user's "fix & resubmit" flow below, this is a
  // correction the admin is making themselves, not a resubmission for
  // review, so status/reviewed_* are left untouched.
  if (body.adminEdit) {
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const parsed = parseEdits(body, expense, project?.settlement_currency)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const updates = parsed.updates
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

    // Guarded on the status read above, so a ticket verified in the meantime
    // stays locked.
    const { data, error } = await supabaseAdmin.from('finance_expenses').update(updates).eq('id', params.id).eq('status', expense.status).select('*').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 })
    await history('edited', data)
    await refreshCategoryMismatchFlag(data.id, data.category, data.concept, data.vendor)
    if (project) await refreshConversionFlags(data, project)
    return NextResponse.json({ expense: data })
  }

  // Replace the receipt photo behind ONE expense — e.g. one entry split out
  // of a multi-receipt photo needs its own, correct image. The other entries
  // from that photo keep pointing at the original. Finance admin, or the
  // original logger (never once verified — see above).
  if (body.replaceReceiptPath !== undefined) {
    if (!admin && expense.logged_by !== profile.id) {
      return NextResponse.json({ error: 'Only a ticket you logged can have its receipt replaced.' }, { status: 403 })
    }
    const path = body.replaceReceiptPath
    if (typeof path !== 'string' || !path.startsWith(`${expense.project_id}/`)) {
      return NextResponse.json({ error: 'Invalid receipt file.' }, { status: 400 })
    }
    const { data: oldReceipt } = expense.receipt_id
      ? await supabaseAdmin.from('finance_receipts').select('file_path').eq('id', expense.receipt_id).maybeSingle()
      : { data: null }
    const { data, error } = await supabaseAdmin
      .from('finance_expenses')
      .update({ receipt_id: null, receipt_file_path: path })
      .eq('id', params.id)
      .eq('status', expense.status)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 })
    await history('photo_replaced', null)
    // The old photo goes once no other ticket split from it still uses it.
    await removeUnusedFinanceFiles(expense.project_id, [oldReceipt?.file_path, expense.receipt_file_path])
    await reverifyExpense(data, profile.id)
    return NextResponse.json({ expense: data })
  }

  // The original logger editing their own expense: while pending it's a
  // correction before review (stays pending); while rejected it's a fix &
  // resubmit (back to pending, review fields cleared). A resubmission is
  // recorded on the ticket's thread — with the optional `comment` typed
  // alongside the fix — and tells Finance.
  if (expense.logged_by !== profile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, MAX_COMMENT_LENGTH) : ''

  const parsed = parseEdits(body, expense, project?.settlement_currency)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const updates: Record<string, unknown> = {
    ...(expense.status === 'rejected' ? { status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null } : {}),
    ...parsed.updates,
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('finance_expenses').update(updates).eq('id', params.id).eq('status', expense.status).select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 })
  const resubmitted = expense.status === 'rejected'
  await history(resubmitted ? 'resubmitted' : 'edited', data, comment || null)
  await refreshCategoryMismatchFlag(data.id, data.category, data.concept, data.vendor)
  if (project) await refreshConversionFlags(data, project)

  // The thread entry goes in before the AI re-check, so the check reads the
  // note that came with the fix.
  let saved = null
  if (resubmitted || comment) {
    const kind = resubmitted ? 'resubmission' : 'comment'
    saved = (await addExpenseComment({ expenseId: data.id, author: profile, side: admin ? 'finance' : 'field', kind, message: comment })).comment
  }
  await reverifyExpense(data, profile.id)
  if (saved) {
    await notifyExpenseThread({
      baseUrl: getBaseUrl(request),
      expense: data,
      side: saved.author_side,
      kind: saved.kind,
      authorId: profile.id,
      authorName: saved.author_name,
      message: comment,
    })
  }
  return NextResponse.json({ expense: data })
}

const CHANGED_MEANWHILE = 'This ticket was reviewed or changed while you were editing it. Reload to see its current state.'
const VALID_CATEGORIES = new Set(Object.keys(FINANCE_EXPENSE_CATEGORY_LABELS))

// The edited values, validated, as column updates. Amount, currency, rate
// and settlement amount are only touched when one of them is sent, and then
// always go through reconcileConversion (finance.ts) so they stay consistent:
// a changed amount, currency or rate re-converts at the rate given; a
// settlement amount sent alongside wins over a rate that disagrees with it.
// Editing only the concept or date never moves the money.
function parseEdits(
  body: Record<string, unknown>,
  expense: FinanceExpense,
  settlementCurrency: string | undefined,
): { updates: Record<string, unknown> } | { error: string } {
  const updates: Record<string, unknown> = {}
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  if (body.concept !== undefined) {
    if (!text(body.concept)) return { error: 'The concept can\'t be empty.' }
    updates.concept = text(body.concept)
  }
  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || !VALID_CATEGORIES.has(body.category)) return { error: 'Unknown category.' }
    updates.category = body.category
  }
  if (body.subLine !== undefined) updates.sub_line = text(body.subLine)
  if (body.date !== undefined) {
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(body.date))) return { error: 'Invalid date.' }
    updates.expense_date = body.date
  }
  if (body.reference !== undefined) updates.reference = text(body.reference)
  if (body.vendor !== undefined) updates.vendor = text(body.vendor)
  if (body.nights !== undefined) {
    const n = body.nights == null || body.nights === '' ? null : Number(body.nights)
    if (n != null && (!Number.isInteger(n) || n < 0)) return { error: 'Nights must be a whole number.' }
    updates.nights = n
  }

  const conversionSent = ['localAmount', 'localCurrency', 'exchangeRate', 'settlementAmount'].some(k => body[k] !== undefined)
  if (conversionSent) {
    if (!settlementCurrency) return { error: 'Project not found.' }
    const currency = body.localCurrency !== undefined ? body.localCurrency : expense.local_currency
    if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency.trim())) return { error: 'The currency must be a 3-letter code.' }
    const reconverts = body.localAmount !== undefined || body.localCurrency !== undefined || body.exchangeRate !== undefined
    const conversion = reconcileConversion({
      localAmount: body.localAmount !== undefined ? body.localAmount : expense.local_amount,
      localCurrency: currency,
      exchangeRate: body.exchangeRate !== undefined ? body.exchangeRate : expense.exchange_rate_used,
      // A changed amount/currency/rate without a settlement figure converts
      // afresh; the stored one would no longer match.
      settlementAmount: body.settlementAmount !== undefined ? body.settlementAmount : reconverts ? null : expense.settlement_amount,
    }, settlementCurrency)
    if ('error' in conversion) return { error: conversion.error }
    updates.local_amount = Number(body.localAmount !== undefined ? body.localAmount : expense.local_amount)
    updates.local_currency = currency.trim().toUpperCase()
    updates.exchange_rate_used = conversion.exchangeRate
    updates.settlement_amount = conversion.settlementAmount
  }
  return { updates }
}

// DELETE /api/finance/expenses/[id] — remove ONE logged expense, leaving
// any others split from the same receipt photo untouched (client feedback:
// one wrong receipt out of a six-receipt photo). Stored files nothing else
// uses are deleted with it; the history keeps what the ticket was. The
// original logger or a finance admin, only while pending or rejected — a
// verified expense is already part of the balance and never disappears.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: expense } = await supabaseAdmin
    .from('finance_expenses')
    .select('*, finance_receipts(file_path)')
    .eq('id', params.id)
    .single<FinanceExpense & { finance_receipts: { file_path: string } | null }>()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (expense.logged_by !== profile.id && !isFinanceAdmin(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (expense.status === 'verified') return NextResponse.json({ error: 'A verified expense can no longer be removed.' }, { status: 409 })
  const closed = await closedProjectError(expense.project_id)
  if (closed) return closed

  const { error } = await supabaseAdmin.from('finance_expenses').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await recordHistory({
    projectId: expense.project_id,
    entityType: 'expense',
    entityId: expense.id,
    action: 'removed',
    actor: profile,
    // What it was, so the history still reads after the row is gone.
    changes: Object.fromEntries(
      (['concept', 'expense_date', 'local_amount', 'local_currency', 'settlement_amount', 'status'] as const)
        .map(f => [f, { from: expense[f], to: null }]),
    ),
  })
  // Its photo goes too, unless other tickets split from the same shot remain;
  // the rate proof is always its own.
  await removeUnusedFinanceFiles(expense.project_id, [
    expense.finance_receipts?.file_path, expense.receipt_file_path, expense.exchange_rate_proof_path,
  ])
  return NextResponse.json({ success: true })
}
