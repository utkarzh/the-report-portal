import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess, closedProjectError } from '@/lib/finance-auth'
import { recordHistory } from '@/lib/finance-history'
import { isFinanceAdmin } from '@/lib/access'
import { computeDeterministicFlags, missingFieldFlags, suspiciousPersonalFlag, categoryMismatchFlag } from '@/lib/finance-flags'
import { verifyEntriesAgainstReceipt, type EntryVerification } from '@/lib/finance-ai'
import { addExpenseComment, formatThreadForReview } from '@/lib/finance-comments'
import { guessFileMimeType, verificationFlags, projectFundsReceived, ticketMarketRate } from '@/lib/finance-review'
import { reconcileConversion } from '@/lib/finance'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpenseCategory } from '@/types'

interface Params {
  params: { id: string }
}

interface EntryInput {
  category: FinanceExpenseCategory
  subLine?: string | null
  concept: string
  date: string
  reference: string | null
  vendor: string | null
  localAmount: number
  localCurrency: string
  // Per-expense, not the project default — rates aren't fixed, the field
  // user enters the real rate for this expense (see UploadReceiptModal).
  exchangeRate: number
  exchangeRateProofPath?: string | null
  settlementAmount: number
  nights: number | null
  lowConfidenceFields?: string[]
  suspiciousPersonal?: boolean
  aiComment?: string | null
  // From the FIRST AI pass (extraction) — may be stale by the time this
  // confirms, since the field user can edit any field after that pass runs.
  // The second pass below (verifyEntriesAgainstReceipt) re-checks the final,
  // possibly-edited values and takes priority when it runs successfully.
  ruleViolation?: string | null
  // The uploader's own explanation for Finance ("taxi to the Saturday
  // meeting with …") — its own field rather than squeezed into the concept;
  // saved as the first message of the ticket's thread.
  comment?: string | null
}

const VALID_CATEGORIES = new Set(Object.keys(FINANCE_EXPENSE_CATEGORY_LABELS))

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
}

// POST /api/finance/projects/[id]/expenses — confirms one or more entries
// (brief D-04; D-05 for multi-trip) as real logged expenses. Every mandatory
// field must be present (brief D-04: "logging is allowed only when all
// mandatory fields are present") — the client's confirm screen is expected to
// have already resolved any AI-flagged low-confidence field, but this route
// re-validates rather than trusting the client.
export async function POST(request: NextRequest, { params }: Params) {
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

  const { data: project } = await supabaseAdmin.from('finance_projects').select('*').eq('id', params.id).single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const closed = await closedProjectError(params.id)
  if (closed) return closed

  const { receiptId, receiptFilePath, entries } = await request.json() as { receiptId: string | null; receiptFilePath?: string | null; entries: EntryInput[] }
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: 'At least one expense entry is required.' }, { status: 400 })
  }

  // Every file a ticket points at must be this project's own — otherwise a
  // member could attach another project's receipt and read it through their
  // ledger (the GET route signs whatever path is stored).
  const ownPath = (p: unknown) => p == null || p === '' || (typeof p === 'string' && p.startsWith(`${params.id}/`))
  if (!ownPath(receiptFilePath) || entries.some(e => !ownPath(e.exchangeRateProofPath))) {
    return NextResponse.json({ error: 'Invalid receipt file.' }, { status: 400 })
  }
  if (receiptId) {
    const { data: ownReceipt } = await supabaseAdmin.from('finance_receipts').select('id').eq('id', receiptId).eq('project_id', params.id).maybeSingle()
    if (!ownReceipt) return NextResponse.json({ error: 'Invalid receipt.' }, { status: 400 })
  }

  for (const e of entries) {
    if (!e.concept?.trim() || !VALID_CATEGORIES.has(e.category) || !isIsoDate(e.date)
      || typeof e.localCurrency !== 'string' || !/^[A-Za-z]{3}$/.test(e.localCurrency.trim())) {
      return NextResponse.json({ error: 'Every expense needs a concept, category, date, amount and a 3-letter currency code.' }, { status: 400 })
    }
    // One rule for rate and amount (finance.ts): they're stored consistent
    // whatever the client sent — 1 for the settlement currency, and the rate
    // implied by the receipt when its own settlement figure was kept.
    const conversion = reconcileConversion(e, project.settlement_currency)
    if ('error' in conversion) return NextResponse.json({ error: conversion.error }, { status: 400 })
    e.localAmount = Number(e.localAmount)
    e.localCurrency = e.localCurrency.trim().toUpperCase()
    e.exchangeRate = conversion.exchangeRate
    e.settlementAmount = conversion.settlementAmount
    e.nights = e.nights != null && Number.isInteger(Number(e.nights)) && Number(e.nights) > 0 ? Number(e.nights) : null
  }

  const { data: existingExpenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('*')
    .eq('project_id', params.id)

  // For the conversion checks (finance-flags.ts conversionFlags): today's
  // market rate per local currency in this upload, and the funds received.
  const fundsReceived = await projectFundsReceived(params.id)
  const localCurrencies = Array.from(new Set(entries.map(e => String(e.localCurrency || '').toUpperCase())))
  const marketRates = new Map(await Promise.all(localCurrencies.map(async c => [c, await ticketMarketRate(project.settlement_currency, c)] as const)))

  // Snapshotted onto every row below, not just looked up live — so removing
  // this person from the project (or deleting their account outright) can
  // never make their past expenses show up nameless.
  const loggedByName = profile.full_name || profile.email || 'Unknown'

  // SECOND AI pass: the field user may have hand-edited any field the first
  // extraction suggested (the client's own real-world complaint — e.g.
  // change the date after the fact) with nothing re-checking that edit
  // against the receipt. Look at the same image again, independently, one
  // time per receipt (not per entry — a multi-trip screenshot shares one
  // image), comparing what was FINALLY submitted. Best-effort: a failed or
  // skipped verification never blocks logging, it just means no extra flags
  // from this pass.
  let verifications: EntryVerification[] | null = null
  const imagePath = receiptFilePath || null
  let resolvedImagePath = imagePath
  let resolvedMimeType: string | null = imagePath ? guessFileMimeType(imagePath) : null
  if (receiptId) {
    const { data: receiptRow } = await supabaseAdmin
      .from('finance_receipts')
      .select('file_path, file_type')
      .eq('id', receiptId)
      .maybeSingle()
    if (receiptRow?.file_path) {
      resolvedImagePath = receiptRow.file_path
      resolvedMimeType = receiptRow.file_type || guessFileMimeType(receiptRow.file_path)
    }
  }
  if (resolvedImagePath && (resolvedMimeType?.startsWith('image/') || resolvedMimeType === 'application/pdf')) {
    try {
      const { data: blob, error: dlError } = await supabaseAdmin.storage.from('finance-receipts').download(resolvedImagePath)
      if (!dlError && blob) {
        const buffer = Buffer.from(await blob.arrayBuffer())
        verifications = await verifyEntriesAgainstReceipt(
          buffer.toString('base64'),
          resolvedMimeType,
          project,
          entries.map(e => ({
            concept: e.concept,
            date: e.date,
            localAmount: e.localAmount,
            localCurrency: e.localCurrency,
            vendor: e.vendor,
            reference: e.reference,
            // The uploader's own explanation, so the check reads it alongside
            // the receipt (and the project's rules).
            conversation: typeof e.comment === 'string' && e.comment.trim()
              ? formatThreadForReview([{ author_side: 'field', author_name: loggedByName, kind: 'comment', message: e.comment }])
              : null,
          })),
          profile.id,
        )
      }
    } catch (err) {
      console.error('Receipt re-verification failed (non-blocking):', err)
    }
  }

  const created = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const verification = verifications?.[i]
    const { data: expense, error } = await supabaseAdmin
      .from('finance_expenses')
      .insert({
        project_id: params.id,
        logged_by: profile.id,
        logged_by_name: loggedByName,
        receipt_id: receiptId || null,
        receipt_file_path: receiptFilePath || null,
        category: e.category,
        sub_line: e.subLine || null,
        concept: e.concept.trim(),
        expense_date: e.date,
        reference: e.reference || null,
        vendor: e.vendor || null,
        local_amount: e.localAmount,
        local_currency: e.localCurrency,
        exchange_rate_used: Number(e.exchangeRate),
        exchange_rate_proof_path: e.exchangeRateProofPath || null,
        settlement_amount: e.settlementAmount,
        nights: e.nights ?? null,
        ai_note: e.aiComment || null,
        status: 'pending',
      })
      .select('*')
      .single()

    if (error || !expense) continue

    // Rule violations: the second pass re-checked the FINAL data and wins
    // when it ran; otherwise fall back to what the first extraction pass
    // (based on the AI's own initial read) already found.
    const secondPassFlags = verification
      ? verificationFlags(verification)
      : e.ruleViolation ? [{ flagType: 'custom_rule_violation' as const, severity: 'warn' as const, message: e.ruleViolation }] : []

    const flags = [
      ...computeDeterministicFlags(
        {
          category: e.category,
          expenseDate: e.date,
          vendor: e.vendor,
          reference: e.reference,
          localAmount: e.localAmount,
          localCurrency: e.localCurrency,
          settlementAmount: e.settlementAmount,
          exchangeRateUsed: Number(e.exchangeRate),
          nights: e.nights ?? null,
          loggedBy: profile.id,
        },
        project,
        existingExpenses ?? [],
        { marketRate: marketRates.get(String(e.localCurrency || '').toUpperCase()) ?? null, fundsReceived },
      ),
      ...missingFieldFlags(e.lowConfidenceFields ?? []),
      ...suspiciousPersonalFlag(e.suspiciousPersonal ?? false, e.aiComment ?? ''),
      ...categoryMismatchFlag(e.category, e.concept, e.vendor),
      ...secondPassFlags,
    ]

    if (flags.length > 0) {
      await supabaseAdmin.from('finance_expense_flags').insert(
        flags.map(f => ({ expense_id: expense.id, flag_type: f.flagType, severity: f.severity, message: f.message })),
      )
    }

    if (typeof e.comment === 'string' && e.comment.trim()) {
      await addExpenseComment({
        expenseId: expense.id,
        author: profile,
        side: isFinanceAdmin(profile) ? 'finance' : 'field',
        kind: 'comment',
        message: e.comment,
      })
    }

    await recordHistory({
      projectId: params.id, entityType: 'expense', entityId: expense.id, action: 'logged', actor: profile,
      changes: Object.fromEntries(
        (['concept', 'expense_date', 'local_amount', 'local_currency', 'exchange_rate_used', 'settlement_amount'] as const)
          .map(f => [f, { from: null, to: expense[f] }]),
      ),
    })

    created.push(expense)
    // Feed this one into subsequent duplicate checks within the same batch
    // (a multi-trip screenshot could otherwise miss duplicates against itself).
    existingExpenses?.push(expense)
  }

  if (created.length === 0) return NextResponse.json({ error: 'Failed to log the expense(s).' }, { status: 500 })

  return NextResponse.json({ expenses: created }, { status: 201 })
}

// GET /api/finance/projects/[id]/expenses — used by the field "My Expenses"
// and rejected-item ("needs your attention") views.
export async function GET(request: NextRequest, { params }: Params) {
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

  const { data: expenses, error } = await supabaseAdmin
    .from('finance_expenses')
    .select('*, finance_expense_flags(*)')
    .eq('project_id', params.id)
    .order('expense_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ expenses: expenses ?? [] })
}
