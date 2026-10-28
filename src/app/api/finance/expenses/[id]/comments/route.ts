import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess, closedProjectError } from '@/lib/finance-auth'
import { recordHistory } from '@/lib/finance-history'
import { isFinanceAdmin } from '@/lib/access'
import { addExpenseComment, notifyExpenseThread, MAX_COMMENT_LENGTH } from '@/lib/finance-comments'
import { reverifyExpense } from '@/lib/finance-review'
import { getBaseUrl } from '@/lib/url'

interface Params { params: { id: string } }

// POST /api/finance/expenses/[id]/comments — { message, sendBack? }
// Adds a message to a ticket's thread (migration 042). Finance (any finance
// admin) and any member of the ticket's project can comment; the other side
// is notified (see notifyExpenseThread).
//
// sendBack: the field team's answer to a rejection when the ticket itself is
// right — "the taxi was on a Saturday because a meeting took place" — so
// nothing needs re-uploading. Only on a rejected ticket, only by the person
// who logged it or the project's Director (who is accountable for every
// ticket on the project). It returns the ticket to pending, exactly like a
// "fix & resubmit", with the reply recorded as a 'resubmission' entry.
//
// A message from the field team on a ticket not yet verified re-runs the AI
// receipt check with the whole conversation (client request, 26 Oct 2026),
// so Finance reads the AI's take on the explanation next to the reply.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: expense } = await supabaseAdmin
    .from('finance_expenses')
    .select('*')
    .eq('id', params.id)
    .single()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const closed = await closedProjectError(expense.project_id)
  if (closed) return closed

  const admin = isFinanceAdmin(profile)
  let projectRole: string | null = null
  if (!admin) {
    const { data: membership } = await supabaseAdmin
      .from('finance_project_members')
      .select('project_role')
      .eq('project_id', expense.project_id)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    projectRole = membership.project_role
  }

  const body = await request.json().catch(() => ({}))
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'Write a comment first.' }, { status: 400 })
  if (message.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json({ error: `Comments are limited to ${MAX_COMMENT_LENGTH} characters.` }, { status: 400 })
  }

  const sendBack = body.sendBack === true
  if (sendBack) {
    if (admin) return NextResponse.json({ error: 'Only the field team sends a ticket back for review.' }, { status: 400 })
    if (expense.status !== 'rejected') {
      return NextResponse.json({ error: 'Only a rejected ticket can be sent back for review.' }, { status: 409 })
    }
    if (expense.logged_by !== profile.id && projectRole !== 'director') {
      return NextResponse.json({ error: "Only the person who logged this ticket or the project's Director can send it back." }, { status: 403 })
    }
  }

  const side = admin ? 'finance' : 'field'
  const kind = sendBack ? 'resubmission' : 'comment'
  const { comment, error } = await addExpenseComment({ expenseId: expense.id, author: profile, side, kind, message })
  if (!comment) return NextResponse.json({ error: error || 'Failed to save the comment.' }, { status: 500 })

  let status = expense.status
  if (sendBack) {
    // Guarded on status so a double click (or the Director and the uploader
    // both answering) can't resubmit twice.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('finance_expenses')
      .update({ status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null })
      .eq('id', expense.id)
      .eq('status', 'rejected')
      .select('status')
      .maybeSingle()
    if (updateError) {
      await supabaseAdmin.from('finance_expense_comments').delete().eq('id', comment.id)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    if (!updated) {
      // Someone else sent it back (or reviewed it) first — don't leave a
      // second "resubmission" on the thread or notify Finance twice.
      await supabaseAdmin.from('finance_expense_comments').delete().eq('id', comment.id)
      return NextResponse.json({ error: 'This ticket was already sent back or reviewed. Reload to see its current state.' }, { status: 409 })
    }
    status = updated.status
    await recordHistory({
      projectId: expense.project_id, entityType: 'expense', entityId: expense.id, action: 'sent_back', actor: profile,
      changes: { status: { from: 'rejected', to: 'pending' } }, note: message,
    })
  }

  if (side === 'field' && expense.status !== 'verified') await reverifyExpense(expense, profile.id)

  await notifyExpenseThread({
    baseUrl: getBaseUrl(request),
    expense,
    side,
    kind,
    authorId: profile.id,
    authorName: comment.author_name,
    message,
  })

  return NextResponse.json({ comment, status }, { status: 201 })
}
