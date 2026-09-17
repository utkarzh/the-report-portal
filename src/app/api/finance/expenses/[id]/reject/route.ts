import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'
import { emailExpenseRejected } from '@/lib/finance-email'
import { getBaseUrl } from '@/lib/url'

interface Params { params: { id: string } }

// POST /api/finance/expenses/[id]/reject — only ever applies to a pending
// expense (the only status the UI offers Reject on), and since the balance
// now only counts verified spend (see computeBalance), a pending expense
// never drew down the balance in the first place — rejecting it is balance-
// neutral, not a reversal. The uploader is still emailed the reason right
// away, not batched — a rejection is a low-frequency, directly-actionable
// event.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { reason } = await request.json()
  if (!reason?.trim()) return NextResponse.json({ error: 'A reason is required.' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('finance_expenses')
    .update({ status: 'rejected', rejection_reason: reason.trim(), reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq('id', params.id)
    .select('*, profiles!finance_expenses_logged_by_fkey(id, email), finance_projects(name)')
    .single<{
      id: string; concept: string; logged_by: string | null; project_id: string
      profiles: { id: string; email: string } | null
      finance_projects: { name: string } | null
    }>()

  if (error || !data) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })

  if (data.logged_by) {
    await supabaseAdmin.from('finance_notifications').insert({
      user_id: data.logged_by,
      type: 'expense_rejected',
      message: `"${data.concept}" was rejected: ${reason.trim()}`,
      link: `/finance/${data.project_id}`,
    })
    if (data.profiles?.email) {
      await emailExpenseRejected(getBaseUrl(request), data.profiles.email, data.finance_projects?.name || 'Project', data.concept, reason.trim(), data.project_id)
    }
  }

  return NextResponse.json({ expense: data })
}
