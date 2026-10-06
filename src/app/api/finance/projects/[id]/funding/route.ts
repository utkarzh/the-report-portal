import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'

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
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { amount, currency, exchangeRate, dateSent, proofImagePath, concept } = await request.json()

  const { data: project } = await supabaseAdmin
    .from('finance_projects')
    .select('id, settlement_currency')
    .eq('id', params.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

  if (proofImagePath != null && (typeof proofImagePath !== 'string' || !proofImagePath.startsWith(`${params.id}/`))) {
    return NextResponse.json({ error: 'Invalid evidence file.' }, { status: 400 })
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
      proof_image_path: proofImagePath || null,
      concept: trimmedConcept || null,
      recorded_by: profile.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ funding }, { status: 201 })
}
