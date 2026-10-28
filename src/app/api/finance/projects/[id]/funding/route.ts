import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin, closedProjectError } from '@/lib/finance-auth'
import { recordHistory, FUNDING_HISTORY_FIELDS } from '@/lib/finance-history'
import { parseFundingAttachments, MAX_FUNDING_ATTACHMENTS } from '@/lib/finance'

interface Params {
  params: { id: string }
}

const MAX_CONCEPT_LENGTH = 200

// POST /api/finance/projects/[id]/funding — finance admin records funds sent
// to the Director (brief C-01: "never the Director"). The first funding sets
// the opening balance; later ones are top-ups — both are just rows in the
// same ledger table (brief C-02).
//
// Evidence and concept are optional (client feedback, Oct 2026): Finance is
// the one recording the transfer, so a proof image every time was needless
// admin work. When the funds were sent in a currency other than the
// project's settlement currency, `exchangeRate` (settlement units per 1 sent
// unit) converts the face value into the credited `amount`.
//
// Evidence can be several files (migration 042): `proofFiles` is a list of
// { path, name }. A single `proofImagePath` from an older client still works.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { amount, currency, exchangeRate, dateSent, proofImagePath, proofFiles, concept } = await request.json()

  const { data: project } = await supabaseAdmin
    .from('finance_projects')
    .select('id, settlement_currency')
    .eq('id', params.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const closed = await closedProjectError(params.id)
  if (closed) return closed

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

  const files = parseFundingAttachments(proofFiles ?? (proofImagePath ? [{ path: proofImagePath }] : []), params.id)
  if (!files) {
    return NextResponse.json({ error: `Invalid evidence files (at most ${MAX_FUNDING_ATTACHMENTS}).` }, { status: 400 })
  }

  const trimmedConcept = typeof concept === 'string' ? concept.trim().slice(0, MAX_CONCEPT_LENGTH) : ''

  const { data: funding, error } = await supabaseAdmin
    .from('finance_fundings')
    .insert({
      project_id: params.id,
      amount: credited,
      sent_amount: sentAmount,
      sent_currency: sentCurrency,
      exchange_rate: rate,
      date_sent: dateSent,
      proof_files: files,
      proof_image_path: files[0]?.path ?? null,
      concept: trimmedConcept || null,
      recorded_by: profile.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await recordHistory({
    projectId: params.id, entityType: 'funding', entityId: funding.id, action: 'funds_recorded', actor: profile,
    changes: Object.fromEntries(FUNDING_HISTORY_FIELDS.map(f => [f, { from: null, to: funding[f] }])),
  })
  return NextResponse.json({ funding }, { status: 201 })
}
