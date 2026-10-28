import { supabaseAdmin } from '@/lib/supabase/admin'

// Who "Finance" is when Cash Box notifies Finance (a field reply on a ticket,
// a ticket sent back for review, a weekly caja submitted). For now only
// office@the-report.com (client decision, 26 Oct 2026): every Finance user
// today is a platform admin and none carries finance_role = 'finance_admin',
// so looking that role up alone reached nobody. Accounts given that role
// later are added automatically.
export const FINANCE_NOTIFICATION_EMAILS = ['office@the-report.com']

export interface FinanceRecipient {
  // null when the address has no account here — it still gets the email,
  // just no in-app notification.
  id: string | null
  email: string
}

export async function financeNotificationRecipients(): Promise<FinanceRecipient[]> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, email, status, finance_role')
    .or(`finance_role.eq.finance_admin,email.in.(${FINANCE_NOTIFICATION_EMAILS.join(',')})`)

  const byEmail = new Map<string, FinanceRecipient>()
  for (const p of data ?? []) {
    if (p.status !== 'active' || !p.email) continue
    byEmail.set(p.email.toLowerCase(), { id: p.id, email: p.email })
  }
  for (const email of FINANCE_NOTIFICATION_EMAILS) {
    if (!byEmail.has(email)) byEmail.set(email, { id: null, email })
  }
  return Array.from(byEmail.values())
}
