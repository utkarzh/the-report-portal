import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'

interface Params {
  params: { id: string }
}

// POST /api/finance/projects/[id]/funding — finance admin records funds sent
// to the Director, evidenced by a proof image the client already uploaded
// directly to the finance-receipts bucket (brief C-01: "never the Director").
// The first funding sets the opening balance; later ones are top-ups — both
// are just rows in the same ledger table (brief C-02).
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { amount, dateSent, proofImagePath } = await request.json()
  const numAmount = Number(amount)
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number.' }, { status: 400 })
  }
  if (!dateSent) return NextResponse.json({ error: 'Date sent is required.' }, { status: 400 })
  if (!proofImagePath) return NextResponse.json({ error: 'Photographic evidence is required.' }, { status: 400 })

  const { data: funding, error } = await supabaseAdmin
    .from('finance_fundings')
    .insert({
      project_id: params.id,
      amount: numAmount,
      date_sent: dateSent,
      proof_image_path: proofImagePath,
      recorded_by: profile.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ funding }, { status: 201 })
}
