import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { categoryMismatchFlag } from '@/lib/finance-flags'
import { verifyEntriesAgainstReceipt } from '@/lib/finance-ai'
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

function guessFileMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  return 'image/jpeg'
}

// Same second-look check the logging route runs (see finance-ai.ts), applied
// to ONE expense after its receipt was replaced or its values were edited —
// so a post-log change gets the same scrutiny as the original upload. Its
// previous verdicts (mismatch / custom-rule flags) are cleared first, since
// they described the old photo or the old values. Best-effort: a failed or
// unreadable receipt just leaves no AI flags rather than blocking the edit.
async function reverifyAgainstReceipt(expense: FinanceExpense, userId: string) {
  await supabaseAdmin.from('finance_expense_flags')
    .delete()
    .eq('expense_id', expense.id)
    .in('flag_type', ['ai_verification_mismatch', 'custom_rule_violation'])
    .eq('resolved', false)

  let path = expense.receipt_file_path
  let mimeType = path ? guessFileMimeType(path) : null
  if (expense.receipt_id) {
    const { data: receiptRow } = await supabaseAdmin.from('finance_receipts').select('file_path, file_type').eq('id', expense.receipt_id).maybeSingle()
    if (receiptRow?.file_path) {
      path = receiptRow.file_path
      mimeType = receiptRow.file_type || guessFileMimeType(receiptRow.file_path)
    }
  }
  if (!path || !mimeType || !(mimeType.startsWith('image/') || mimeType === 'application/pdf')) return

  try {
    const { data: project } = await supabaseAdmin.from('finance_projects').select('*').eq('id', expense.project_id).single()
    const { data: blob, error: dlError } = await supabaseAdmin.storage.from('finance-receipts').download(path)
    if (!project || dlError || !blob) return
    const buffer = Buffer.from(await blob.arrayBuffer())
    const [verification] = await verifyEntriesAgainstReceipt(buffer.toString('base64'), mimeType, project, [{
      concept: expense.concept,
      date: expense.expense_date,
      localAmount: Number(expense.local_amount),
      localCurrency: expense.local_currency,
      vendor: expense.vendor,
      reference: expense.reference,
    }], userId)
    if (!verification) return
    const flags = [
      ...verification.mismatches.map(m => ({
        flag_type: 'ai_verification_mismatch',
        severity: 'crit',
        message: `Submitted ${m.field} ("${m.submittedValue}") doesn't match what's visible on the receipt ("${m.visibleValue}") — ${m.note}`,
      })),
      ...(verification.ruleViolation ? [{ flag_type: 'custom_rule_violation', severity: 'warn', message: verification.ruleViolation }] : []),
    ]
    if (flags.length > 0) {
      await supabaseAdmin.from('finance_expense_flags').insert(flags.map(f => ({ ...f, expense_id: expense.id })))
    }
  } catch (err) {
    console.error('Expense re-verification failed (non-blocking):', err)
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

  // Replace the receipt photo behind ONE expense — e.g. one entry split out
  // of a multi-receipt photo needs its own, correct image. The other entries
  // from that photo keep pointing at the original. Finance admin on any
  // expense; the original logger only while it isn't verified yet.
  if (body.replaceReceiptPath !== undefined) {
    if (!admin && (expense.logged_by !== profile.id || expense.status === 'verified')) {
      return NextResponse.json({ error: 'Only an unverified expense you logged can have its receipt replaced.' }, { status: 403 })
    }
    const path = body.replaceReceiptPath
    if (typeof path !== 'string' || !path.startsWith(`${expense.project_id}/`)) {
      return NextResponse.json({ error: 'Invalid receipt file.' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
      .from('finance_expenses')
      .update({ receipt_id: null, receipt_file_path: path })
      .eq('id', params.id)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await reverifyAgainstReceipt(data, profile.id)
    return NextResponse.json({ expense: data })
  }

  // The original logger editing their own expense: while pending it's a
  // correction before review (stays pending); while rejected it's a fix &
  // resubmit (back to pending, review fields cleared). Verified is final.
  if (expense.logged_by !== profile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (expense.status === 'verified') return NextResponse.json({ error: 'A verified expense can no longer be edited.' }, { status: 409 })

  const updates: Record<string, unknown> = expense.status === 'rejected'
    ? { status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null }
    : {}
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
  await reverifyAgainstReceipt(data, profile.id)
  return NextResponse.json({ expense: data })
}

// DELETE /api/finance/expenses/[id] — remove ONE logged expense, leaving
// any others split from the same receipt photo untouched (client feedback:
// one wrong receipt out of a six-receipt photo). The original logger or a
// finance admin, only while pending or rejected — a verified expense is
// already part of the balance and never disappears.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: expense } = await supabaseAdmin.from('finance_expenses').select('logged_by, status').eq('id', params.id).single()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (expense.logged_by !== profile.id && !isFinanceAdmin(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (expense.status === 'verified') return NextResponse.json({ error: 'A verified expense can no longer be removed.' }, { status: 409 })

  const { error } = await supabaseAdmin.from('finance_expenses').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
