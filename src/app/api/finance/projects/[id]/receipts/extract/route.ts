import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { extractReceiptData, computeSettlementAmount } from '@/lib/finance-ai'

interface Params {
  params: { id: string }
}

// POST /api/finance/projects/[id]/receipts/extract — the browser has already
// uploaded the image/PDF straight to the finance-receipts bucket; this reads
// it back server-side, runs Claude vision extraction (brief D-03/D-05), and
// returns the parsed entries for the field user to confirm before logging —
// nothing is written to finance_expenses yet (that happens on confirm, see
// POST .../expenses), so an abandoned upload never creates a phantom expense.
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

  const { storagePath, mimeType } = await request.json()
  if (!storagePath || !storagePath.startsWith(`${params.id}/`)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }
  if (!mimeType?.startsWith('image/')) {
    return NextResponse.json({ error: 'Only image receipts can be read automatically right now — PDFs can still be logged manually.' }, { status: 400 })
  }

  const { data: blob, error: dlError } = await supabaseAdmin.storage.from('finance-receipts').download(storagePath)
  if (dlError || !blob) return NextResponse.json({ error: 'Uploaded file not found in storage' }, { status: 400 })

  let result
  try {
    const buffer = Buffer.from(await blob.arrayBuffer())
    result = await extractReceiptData(buffer.toString('base64'), mimeType, project, profile.id)
  } catch (err) {
    console.error('Receipt extraction failed:', err)
    return NextResponse.json({ error: 'Could not read this receipt automatically. You can still log it manually.' }, { status: 502 })
  }

  const { data: receipt, error: receiptError } = await supabaseAdmin
    .from('finance_receipts')
    .insert({
      project_id: params.id,
      uploaded_by: profile.id,
      file_path: storagePath,
      file_type: mimeType,
      ai_extraction: result,
    })
    .select('id')
    .single()

  if (receiptError || !receipt) return NextResponse.json({ error: 'Failed to save the receipt record.' }, { status: 500 })

  const entries = result.entries.map(e => ({
    ...e,
    settlementAmount: computeSettlementAmount(e, Number(project.exchange_rate)),
  }))

  return NextResponse.json({
    receiptId: receipt.id,
    couldNotRead: result.couldNotRead,
    note: result.note,
    entries,
    exchangeRate: Number(project.exchange_rate),
    settlementCurrency: project.settlement_currency,
  })
}
