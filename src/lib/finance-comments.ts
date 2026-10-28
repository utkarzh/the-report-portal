import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { emailExpenseThreadUpdate } from '@/lib/finance-email'
import { financeNotificationRecipients, type FinanceRecipient } from '@/lib/finance-admins'
import type { FinanceCommentSide, FinanceExpenseComment, FinanceExpenseCommentKind } from '@/types'

// Ticket comment threads (migration 042, client feedback 26 Oct 2026): a
// rejected ticket can be correct as it is — a Saturday taxi because a meeting
// took place — so the field user replies and sends it back instead of
// uploading a new receipt, and Finance and the field team can talk about a
// ticket without squeezing explanations into its concept.

export const MAX_COMMENT_LENGTH = 2000

// Read in batches of ids so a project with hundreds of tickets never builds an
// over-long `in (...)` URL. A failed read (e.g. before migration 042 has run)
// yields no comments rather than taking down the ledger around them. Pass the
// request-scoped client on pages that rely on RLS, supabaseAdmin in routes
// that have already checked access.
const ID_BATCH = 100

export async function loadExpenseComments(
  client: Pick<SupabaseClient, 'from'>,
  expenseIds: string[],
): Promise<Record<string, FinanceExpenseComment[]>> {
  const byExpense: Record<string, FinanceExpenseComment[]> = {}
  for (let i = 0; i < expenseIds.length; i += ID_BATCH) {
    const { data, error } = await client
      .from('finance_expense_comments')
      .select('*')
      .in('expense_id', expenseIds.slice(i, i + ID_BATCH))
      .order('created_at')
    if (error) {
      console.error('Loading ticket comments failed:', error.message)
      return {}
    }
    for (const c of (data ?? []) as FinanceExpenseComment[]) (byExpense[c.expense_id] ??= []).push(c)
  }
  return byExpense
}

export async function addExpenseComment(params: {
  expenseId: string
  author: { id: string; full_name: string | null; email: string | null }
  side: FinanceCommentSide
  kind: FinanceExpenseCommentKind
  message: string
}): Promise<{ comment: FinanceExpenseComment | null; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from('finance_expense_comments')
    .insert({
      expense_id: params.expenseId,
      author_id: params.author.id,
      author_name: params.author.full_name || params.author.email || 'Unknown',
      author_side: params.side,
      kind: params.kind,
      message: params.message.trim().slice(0, MAX_COMMENT_LENGTH),
    })
    .select('*')
    .single()
  if (error) {
    console.error('Saving a ticket comment failed:', error.message)
    return { comment: null, error: error.message }
  }
  return { comment: data as FinanceExpenseComment, error: null }
}

// A ticket's thread as plain lines for the AI receipt check (see
// finance-review.ts) — the uploader's explanation, and once Finance has asked
// something, the whole exchange, so the reviewer reads the answer in context.
export function formatThreadForReview(comments: Pick<FinanceExpenseComment, 'author_side' | 'author_name' | 'kind' | 'message'>[]): string | null {
  const lines = comments
    .filter(c => c.message.trim() || c.kind !== 'comment')
    .map(c => {
      const who = `${c.author_side === 'finance' ? 'Finance' : 'Field team'} (${c.author_name || 'unknown'})`
      const what = c.kind === 'rejection' ? ' rejected the ticket' : c.kind === 'resubmission' ? ' sent it back for review' : ''
      return `${who}${what}: ${c.message.trim() || '(no message — corrected values)'}`
    })
  return lines.length > 0 ? lines.join('\n') : null
}

// Tells the other side a thread moved — in-app (finance_notifications) and by
// email, best-effort. Finance writing → the ticket's uploader. The field team
// writing → Finance, i.e. financeNotificationRecipients() (office@ for now).
export async function notifyExpenseThread(params: {
  baseUrl: string
  expense: { concept: string; project_id: string; logged_by: string | null }
  side: FinanceCommentSide
  kind: FinanceExpenseCommentKind
  authorId: string
  authorName: string
  message: string
}) {
  const { baseUrl, expense, side, kind, authorId, authorName, message } = params
  try {
    let recipients: FinanceRecipient[]
    if (side === 'finance') {
      if (!expense.logged_by) return
      const { data: uploader } = await supabaseAdmin.from('profiles').select('email').eq('id', expense.logged_by).maybeSingle()
      recipients = [{ id: expense.logged_by, email: uploader?.email ?? '' }]
    } else {
      recipients = await financeNotificationRecipients()
    }
    recipients = recipients.filter(r => r.id !== authorId)
    if (recipients.length === 0) return

    const { data: project } = await supabaseAdmin.from('finance_projects').select('name').eq('id', expense.project_id).maybeSingle()
    const path = side === 'finance' ? `/finance/${expense.project_id}` : `/finance/admin/projects/${expense.project_id}`
    const action = kind === 'resubmission' ? 'sent back for review' : 'commented on'
    const snippet = message.length > 120 ? `${message.slice(0, 117)}…` : message

    const inApp = recipients.filter(r => r.id)
    if (inApp.length > 0) {
      await supabaseAdmin.from('finance_notifications').insert(inApp.map(r => ({
        user_id: r.id,
        type: kind === 'resubmission' ? 'expense_resubmitted' : 'expense_comment',
        message: `${authorName} ${action} "${expense.concept}"${snippet ? `: ${snippet}` : ''}`,
        link: path,
      })))
    }
    for (const r of recipients) {
      if (!r.email) continue
      await emailExpenseThreadUpdate({
        baseUrl,
        to: r.email,
        projectName: project?.name || 'Project',
        concept: expense.concept,
        authorName,
        message,
        resubmitted: kind === 'resubmission',
        path,
      })
    }
  } catch (err) {
    console.error('Ticket comment notification failed (non-blocking):', err)
  }
}
