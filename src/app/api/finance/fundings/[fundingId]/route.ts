import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'

interface Params {
  params: { fundingId: string }
}

const MAX_CONCEPT_LENGTH = 200

// PATCH /api/finance/fundings/[fundingId] — finance admin corrects an
// already-recorded funding (amount, currency, exchange rate, date, concept,
// evidence). Admin-only, same as recording one in the first place (client
// request, Oct 2026) — a Director never sees or reaches this route; the
// admin project page is the only caller. Mirrors the POST route's validation
// exactly so an edit can't produce a row a fresh submission couldn't.
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error

  const { data: funding } = await supabaseAdmin
    .from('finance_fundings')
    .select('id, project_id, proof_image_path')
    .eq('id', params.fundingId)
    .single()
  if (!funding) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: project } = await supabaseAdmin
    .from('finance_projects')
    .select('id, settlement_currency')
    .eq('id', funding.project_id)
    .single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { amount, currency, exchangeRate, dateSent, proofImagePath, concept } = await request.json()

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

  // `undefined` in the payload (the modal didn't touch evidence) keeps the
  // existing file; an explicit path (a replacement was uploaded) or null (a
  // future "remove evidence" control) overwrites it. Either way, a non-null
  // path must belong to this project's folder.
  let nextProofPath = funding.proof_image_path
  if (proofImagePath !== undefined) {
    if (proofImagePath != null && (typeof proofImagePath !== 'string' || !proofImagePath.startsWith(`${funding.project_id}/`))) {
      return NextResponse.json({ error: 'Invalid evidence file.' }, { status: 400 })
    }
    nextProofPath = proofImagePath
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
      proof_image_path: nextProofPath,
      concept: trimmedConcept || null,
    })
    .eq('id', params.fundingId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ funding: updated })
}
