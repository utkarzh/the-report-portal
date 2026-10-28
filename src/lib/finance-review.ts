import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyEntriesAgainstReceipt, type EntryVerification } from '@/lib/finance-ai'
import { formatThreadForReview } from '@/lib/finance-comments'
import { conversionFlags } from '@/lib/finance-flags'
import { marketRate } from '@/lib/fx-rates'
import { checkRate, formatRate, isGrossRateError } from '@/lib/fx-check'
import { isSameCurrency } from '@/lib/finance'
import type { FinanceExpense, FinanceExpenseComment, FinanceProject } from '@/types'

export function guessFileMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  return 'image/jpeg'
}

// The flags the second AI pass writes. comment_review is the AI's read of
// the field team's own explanation (client request, 26 Oct 2026: "comments
// should also be passed to AI for review") — info only, Finance decides.
export const VERIFICATION_FLAG_TYPES = ['ai_verification_mismatch', 'custom_rule_violation', 'comment_review'] as const

export function verificationFlags(verification: EntryVerification) {
  return [
    // Crit: the submitted value for this field doesn't match what's actually
    // visible on the receipt — whether an honest mistake or a deliberate edit
    // after the AI's first read, it needs a human's eyes.
    ...verification.mismatches.map(m => ({
      flagType: 'ai_verification_mismatch' as const,
      severity: 'crit' as const,
      message: `Submitted ${m.field} ("${m.submittedValue}") doesn't match what's visible on the receipt ("${m.visibleValue}") — ${m.note}`,
    })),
    ...(verification.ruleViolation ? [{ flagType: 'custom_rule_violation' as const, severity: 'warn' as const, message: verification.ruleViolation }] : []),
    ...(verification.commentReview ? [{ flagType: 'comment_review' as const, severity: 'info' as const, message: `On the uploader's explanation: ${verification.commentReview}` }] : []),
  ]
}

// Same second-look check the logging route runs (see finance-ai.ts), applied
// to ONE expense after its receipt was replaced, its values were edited, or
// the field team added to its thread — so a post-log change gets the same
// scrutiny as the original upload, and the AI reads the latest explanation.
// Its previous verdicts are cleared first, since they described the old
// photo, values or conversation. Best-effort: a failed or unreadable receipt
// just leaves no AI flags rather than blocking the action.
export async function reverifyExpense(expense: FinanceExpense, userId: string) {
  await supabaseAdmin.from('finance_expense_flags')
    .delete()
    .eq('expense_id', expense.id)
    .in('flag_type', [...VERIFICATION_FLAG_TYPES])
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
    const [{ data: project }, { data: blob, error: dlError }, { data: comments }] = await Promise.all([
      supabaseAdmin.from('finance_projects').select('*').eq('id', expense.project_id).single(),
      supabaseAdmin.storage.from('finance-receipts').download(path),
      supabaseAdmin.from('finance_expense_comments').select('author_side, author_name, kind, message').eq('expense_id', expense.id).order('created_at'),
    ])
    if (!project || dlError || !blob) return
    const buffer = Buffer.from(await blob.arrayBuffer())
    const [verification] = await verifyEntriesAgainstReceipt(buffer.toString('base64'), mimeType, project, [{
      concept: expense.concept,
      date: expense.expense_date,
      localAmount: Number(expense.local_amount),
      localCurrency: expense.local_currency,
      vendor: expense.vendor,
      reference: expense.reference,
      conversation: formatThreadForReview((comments ?? []) as FinanceExpenseComment[]),
    }], userId)
    if (!verification) return
    const flags = verificationFlags(verification)
    if (flags.length > 0) {
      await supabaseAdmin.from('finance_expense_flags').insert(
        flags.map(f => ({ expense_id: expense.id, flag_type: f.flagType, severity: f.severity, message: f.message })),
      )
    }
  } catch (err) {
    console.error('Expense re-verification failed (non-blocking):', err)
  }
}

// Everything the project has received so far — funds plus transfers in, in
// its settlement currency — for the implausible-amount check.
export async function projectFundsReceived(projectId: string): Promise<number> {
  const [{ data: fundings }, { data: transfersIn }] = await Promise.all([
    supabaseAdmin.from('finance_fundings').select('amount').eq('project_id', projectId),
    supabaseAdmin.from('finance_transfers').select('amount, to_amount').eq('to_project_id', projectId),
  ])
  return (fundings ?? []).reduce((s, f) => s + Number(f.amount), 0)
    + (transfersIn ?? []).reduce((s, t) => s + Number(t.to_amount ?? t.amount), 0)
}

// Today's market rate as local units per 1 settlement unit — the direction
// every ticket's exchange_rate_used is stored in. null when unavailable.
export async function ticketMarketRate(settlementCurrency: string, localCurrency: string): Promise<number | null> {
  return (await marketRate(settlementCurrency, localCurrency))?.rate ?? null
}

// A conversion so wrong it must be fixed before the ticket can be verified:
// once verified a ticket is locked for good (client decision, 26 Oct 2026),
// so verifying Jamaica's 40,000 JMD taxi booked as 6.3M USD could never be
// undone. Blocks a ticket in the settlement currency that isn't 1:1, and a
// conversion that's inverted or 10× or more off today's market rate —
// judged on the rate the money was actually converted at. With no market
// rate available nothing is blocked (the flags still show).
export async function conversionBlocker(
  expense: Pick<FinanceExpense, 'local_amount' | 'local_currency' | 'settlement_amount' | 'exchange_rate_used'>,
  settlementCurrency: string,
): Promise<string | null> {
  const local = Number(expense.local_amount)
  const settlement = Number(expense.settlement_amount)
  const booked = `${local.toLocaleString('en-US')} ${expense.local_currency} is booked as ${settlement.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${settlementCurrency}`
  const fix = 'Fix the amount or exchange rate with Edit first — a verified ticket can no longer be changed.'
  if (isSameCurrency(expense.local_currency, settlementCurrency)) {
    return Math.abs(local - settlement) <= 0.01 ? null : `Can't verify: ${booked}, but it's already in ${settlementCurrency}. ${fix}`
  }
  const market = await ticketMarketRate(settlementCurrency, expense.local_currency)
  if (!market) return null
  const effective = settlement >= 0.5 && local > 0 ? local / settlement : Number(expense.exchange_rate_used)
  if (checkRate(effective, market).verdict === 'inverted' || isGrossRateError(effective, market)) {
    return `Can't verify: ${booked} (${formatRate(effective)} ${expense.local_currency} per ${settlementCurrency}), but today's rate is about ${formatRate(market)}. ${fix}`
  }
  return null
}

// Re-runs the currency and implausible-amount checks for ONE ticket after
// its values changed (an edit, or a re-conversion at a corrected rate), in
// place of whatever they said before.
export async function refreshConversionFlags(
  expense: Pick<FinanceExpense, 'id' | 'project_id' | 'local_amount' | 'local_currency' | 'settlement_amount' | 'exchange_rate_used'>,
  project: Pick<FinanceProject, 'exchange_rate' | 'settlement_currency'>,
) {
  try {
    const [others, fundsReceived, market] = await Promise.all([
      supabaseAdmin.from('finance_expenses').select('status, settlement_amount').eq('project_id', expense.project_id).neq('id', expense.id),
      projectFundsReceived(expense.project_id),
      ticketMarketRate(project.settlement_currency, expense.local_currency),
    ])
    await supabaseAdmin.from('finance_expense_flags')
      .delete()
      .eq('expense_id', expense.id)
      .in('flag_type', ['currency_anomaly', 'implausible_amount'])
      .eq('resolved', false)
    const flags = conversionFlags({
      localAmount: Number(expense.local_amount),
      localCurrency: expense.local_currency,
      settlementAmount: Number(expense.settlement_amount),
      exchangeRateUsed: Number(expense.exchange_rate_used),
    }, project, others.data ?? [], { marketRate: market, fundsReceived })
    if (flags.length > 0) {
      await supabaseAdmin.from('finance_expense_flags').insert(
        flags.map(f => ({ expense_id: expense.id, flag_type: f.flagType, severity: f.severity, message: f.message })),
      )
    }
  } catch (err) {
    console.error('Refreshing conversion flags failed (non-blocking):', err)
  }
}
