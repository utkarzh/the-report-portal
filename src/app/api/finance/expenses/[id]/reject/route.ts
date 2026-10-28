import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin, closedProjectError } from '@/lib/finance-auth'
import { recordHistory } from '@/lib/finance-history'
import { emailExpenseRejected } from '@/lib/finance-email'
import { addExpenseComment } from '@/lib/finance-comments'
import { getBaseUrl } from '@/lib/url'

interface Params { params: { id: string } }

// POST /api/finance/expenses/[id]/reject — only ever applies to a pending
// expense (the only status the UI offers Reject on), and since the balance
// now only counts verified spend (see computeBalance), a pending expense
// never drew down the balance in the first place — rejecting it is balance-
// neutral, not a reversal. The uploader is still emailed the reason right
// away, not batched — a rejection is a low-frequency, directly-actionable
// event.
//
// The reason also opens (or continues) the ticket's comment thread, so it's
// still in the history after the field user replies and sends the ticket
// back — sending it back clears rejection_reason.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { reason } = await request.json()
  if (!reason?.trim()) return NextResponse.json({ error: 'A reason is required.' }, { status: 400 })

  // Only a pending ticket — a verified one is locked (client decision, 26
  // Oct 2026) — and never on a closed project.
  const { data: before } = await supabaseAdmin.from('finance_expenses').select('project_id, status').eq('id', params.id).single()
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const closed = await closedProjectError(before.project_id)
  if (closed) return closed
  if (before.status !== 'pending') return NextResponse.json({ error: `Only a pending ticket can be rejected (this one is ${before.status}).` }, { status: 409 })

  const { data, error } = await supabaseAdmin
    .from('finance_expenses')
    .update({ status: 'rejected', rejection_reason: reason.trim(), reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('status', 'pending')
    .select('*, profiles!finance_expenses_logged_by_fkey(id, email), finance_projects(name)')
    .maybeSingle<{
      id: string; concept: string; logged_by: string | null; project_id: string
      profiles: { id: string; email: string } | null
      finance_projects: { name: string } | null
    }>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'This ticket was changed while you were reviewing it. Reload to see its current state.' }, { status: 409 })

  // Best-effort: rejection_reason on the row is what the ledgers show, so a
  // failed thread write doesn't undo the rejection.
  await addExpenseComment({ expenseId: data.id, author: profile, side: 'finance', kind: 'rejection', message: reason.trim() })
  await recordHistory({
    projectId: data.project_id, entityType: 'expense', entityId: data.id, action: 'rejected', actor: profile,
    changes: { status: { from: 'pending', to: 'rejected' } }, note: reason.trim(),
  })

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
