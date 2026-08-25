import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'

// GET /api/finance/review-queue — brief E-01: "a review queue of logged
// expenses ... spans all my projects, filterable by project, status, and
// category. Each item shows the receipt image beside its extracted data."
export async function GET(request: NextRequest) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error

  const project = request.nextUrl.searchParams.get('project')
  const status = request.nextUrl.searchParams.get('status') || 'pending'
  const category = request.nextUrl.searchParams.get('category')

  let query = supabaseAdmin
    .from('finance_expenses')
    .select('*, finance_expense_flags(*), finance_projects(name, settlement_currency, exchange_rate), profiles!finance_expenses_logged_by_fkey(full_name, email), finance_receipts(file_path)')
    .order('created_at', { ascending: false })

  if (status !== 'all') query = query.eq('status', status)
  if (project) query = query.eq('project_id', project)
  if (category) query = query.eq('category', category)

  const { data: expenses, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Private bucket — sign a short-lived URL per receipt so the review queue
  // can show the image beside the extracted data (brief E-01).
  const withUrls = await Promise.all((expenses ?? []).map(async (e) => {
    const path = e.finance_receipts?.file_path || e.receipt_file_path
    if (!path) return { ...e, receiptUrl: null }
    const { data: signed } = await supabaseAdmin.storage.from('finance-receipts').createSignedUrl(path, 3600)
    return { ...e, receiptUrl: signed?.signedUrl ?? null }
  }))

  return NextResponse.json({ expenses: withUrls })
}
