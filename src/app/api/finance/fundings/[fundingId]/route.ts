import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin, closedProjectError } from '@/lib/finance-auth'
import { recordHistory, diffFields, FUNDING_HISTORY_FIELDS } from '@/lib/finance-history'
import { parseFundingAttachments, MAX_FUNDING_ATTACHMENTS } from '@/lib/finance'
import { removeUnusedFinanceFiles } from '@/lib/finance-attachments'
import type { FinanceAttachment } from '@/types'

interface Params {
  params: { fundingId: string }
}

const MAX_CONCEPT_LENGTH = 200

// PATCH /api/finance/fundings/[fundingId] — finance admin corrects an
// already-recorded funding (amount, currency, exchange rate, date, concept,
// evidence files). Admin-only, same as recording one in the first place (client
// request, Oct 2026) — a Director never sees or reaches this route; the
// admin project page is the only caller. Mirrors the POST route's validation
// exactly so an edit can't produce a row a fresh submission couldn't.
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: funding } = await supabaseAdmin
    .from('finance_fundings')
    .select('*')
    .eq('id', params.fundingId)
    .single()
  if (!funding) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const closed = await closedProjectError(funding.project_id)
  if (closed) return closed

  const { data: project } = await supabaseAdmin
    .from('finance_projects')
    .select('id, settlement_currency')
    .eq('id', funding.project_id)
    .single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { amount, currency, exchangeRate, dateSent, proofImagePath, proofFiles, concept } = await request.json()

  const sentAmount = Number(amount)
  if (!Number.isFinite(sentAmount) || sentAmount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number.' }, { status: 400 })
  }
  if (!dateSent) return NextResponse.json({ error: 'Date sent is required.' }, { status: 400 })

  const sentCurrency = typeof currency === 'string' && currency.trim()
    ? currency.trim().toUpperCase()
    : project.settlement_currency
  if (!/^[A-Z]{3}$/.test(sentCurrency)) {
    return NextResponse.json({ error: 'Currency must be a 3-letter code (e.g. EUR).' }, { status: 400 })
  }

  let rate = 1
  if (sentCurrency !== project.settlement_currency) {
    rate = Number(exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json({
        error: `An exchange rate is required when sending ${sentCurrency} to a ${project.settlement_currency} project.`,
      }, { status: 400 })
    }
  }
  const credited = Math.round(sentAmount * rate * 100) / 100
  if (credited <= 0) return NextResponse.json({ error: 'The converted amount must be positive.' }, { status: 400 })

  // `proofFiles` is the full list after the edit — the files kept plus any
  // newly uploaded (migration 042). Omitted, the existing evidence is left
  // alone. A single `proofImagePath` from an older client replaces it with
  // that one file (or clears it on null), as it did before. Files dropped
  // here are deleted from storage once the edit is saved.
  const previousFiles: FinanceAttachment[] = funding.proof_files?.length
    ? funding.proof_files
    : funding.proof_image_path ? [{ path: funding.proof_image_path, name: 'Evidence' }] : []
  let nextFiles = previousFiles
  if (proofFiles !== undefined || proofImagePath !== undefined) {
    const parsed = parseFundingAttachments(
      proofFiles !== undefined ? proofFiles : (proofImagePath ? [{ path: proofImagePath }] : []),
      funding.project_id,
    )
    if (!parsed) {
      return NextResponse.json({ error: `Invalid evidence files (at most ${MAX_FUNDING_ATTACHMENTS}).` }, { status: 400 })
    }
    nextFiles = parsed
  }

  const trimmedConcept = typeof concept === 'string' ? concept.trim().slice(0, MAX_CONCEPT_LENGTH) : ''

  const { data: updated, error } = await supabaseAdmin
    .from('finance_fundings')
    .update({
      amount: credited,
      sent_amount: sentAmount,
      sent_currency: sentCurrency,
      exchange_rate: rate,
      date_sent: dateSent,
      proof_files: nextFiles,
      proof_image_path: nextFiles[0]?.path ?? null,
      concept: trimmedConcept || null,
    })
    .eq('id', params.fundingId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await recordHistory({
    projectId: funding.project_id, entityType: 'funding', entityId: funding.id, action: 'funds_edited', actor: profile,
    changes: diffFields({ ...funding, proof_files: previousFiles }, updated, FUNDING_HISTORY_FIELDS),
  })

  const kept = new Set(nextFiles.map(f => f.path))
  await removeUnusedFinanceFiles(funding.project_id, previousFiles.map(f => f.path).filter(p => !kept.has(p)))
  return NextResponse.json({ funding: updated })
}
