import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { emailReceiptReminderMidweek, emailReceiptReminderFriday, emailAdminReviewReminder } from '@/lib/finance-email'
import { getBaseUrl } from '@/lib/url'

export const dynamic = 'force-dynamic'

// Who gets nudged to review the week's cajas — overridable via env (comma-
// separated) without a redeploy of this list; defaults to the two addresses
// the client asked for directly.
const FINANCE_ADMIN_REVIEW_RECIPIENTS = process.env.FINANCE_ADMIN_REMINDER_EMAILS?.split(',').map(s => s.trim()).filter(Boolean)
  ?? ['office@the-report.com', 'utkarsh.parihar.435@gmail.com']

// GET /api/cron/finance-reminders?type=midweek|friday — invoked by Vercel
// Cron (see vercel.json). Vercel adds `Authorization: Bearer $CRON_SECRET`
// automatically when the project has a CRON_SECRET env var, so this checks
// that header rather than a session — fails closed (401) if it's missing or
// wrong, including when CRON_SECRET itself isn't configured.
//
// Blasts every active field user (directors + sales reps — the people who
// actually log receipts) every time this runs, with no per-user "already
// uploaded this week?" check, per the client's request.
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const type = request.nextUrl.searchParams.get('type')
  if (type !== 'midweek' && type !== 'friday') {
    return NextResponse.json({ error: 'type must be "midweek" or "friday"' }, { status: 400 })
  }

  const { data: recipients, error } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('status', 'active')
    .eq('finance_role', 'field')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const baseUrl = getBaseUrl(request)
  const send = type === 'midweek' ? emailReceiptReminderMidweek : emailReceiptReminderFriday
  await Promise.all((recipients ?? []).map(r => send(baseUrl, r.email)))

  // Friday only — the week's uploads are in by now, so this is when it's
  // actually worth nudging Finance to clear the review queue.
  let adminsSent = 0
  if (type === 'friday') {
    await Promise.all(FINANCE_ADMIN_REVIEW_RECIPIENTS.map(email => emailAdminReviewReminder(baseUrl, email)))
    adminsSent = FINANCE_ADMIN_REVIEW_RECIPIENTS.length
  }

  return NextResponse.json({ type, sent: (recipients ?? []).length, adminsSent })
}
