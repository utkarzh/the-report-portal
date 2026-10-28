import { sendEmail } from '@/lib/email/smtp'
import { renderEmailShell, emailButton } from '@/lib/email/template'
import type { FinanceAuditVerdict } from '@/types'

// Email is layered on top of the in-app finance_notifications inbox, not a
// replacement for it — every function here is best-effort (a failed send
// never breaks the underlying action).
//
// Primary flow (the project-page ledger, per the corrected model): rejecting
// an expense emails the uploader immediately with the typed reason —
// low-frequency and directly actionable, so it doesn't need batching.
// Verifying stays silent (in-app only); it's the routine, expected outcome.
//
// The caja*-named functions below back the weekly-caja state machine, which
// is no longer the primary review flow (that's now the project page's
// combined ledger) — kept for the pages that still use it, not deleted.

export async function emailExpenseRejected(
  baseUrl: string,
  to: string,
  projectName: string,
  concept: string,
  reason: string,
  projectId: string,
) {
  const link = `${baseUrl}/finance/${projectId}`
  await safeSend({
    to,
    subject: `Cash Box: "${concept}" was rejected — ${projectName}`,
    text: `Your expense "${concept}" on ${projectName} was rejected:\n\n${reason}\n\nFix it and resubmit — or, if it's correct as it is, reply on the ticket and send it back for review: ${link}`,
    html: renderEmailShell({
      preheader: `"${concept}" was rejected — action needed`,
      bodyHtml: `
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111111;">Expense rejected</p>
<p style="margin:0 0 18px;color:#4b4844;">Your expense on <b>${projectName}</b> was rejected — it needs a fix or an explanation before it can be approved.</p>
<div style="margin:0 0 22px;padding:14px 18px;background-color:#fdf2f2;border:1px solid #f3c6c6;border-radius:8px;">
<div style="font-weight:600;color:#8a1f1f;margin-bottom:4px;">"${concept}"</div>
<div style="color:#8a1f1f;font-size:13px;">${reason}</div>
</div>
<p style="margin:0 0 22px;color:#4b4844;">If the ticket is correct as it is, reply on it and send it back for review — no need to upload it again.</p>
${emailButton('Open the ticket', link)}`,
    }),
  })
}

// A message on a ticket's thread (see lib/finance-comments.ts) — Finance
// asking the uploader something, or the field team replying / sending a
// rejected ticket back. The message is typed by a person, so it's escaped
// before it goes into the HTML.
export async function emailExpenseThreadUpdate(params: {
  baseUrl: string
  to: string
  projectName: string
  concept: string
  authorName: string
  message: string
  resubmitted: boolean
  path: string
}) {
  const { baseUrl, to, projectName, concept, authorName, message, resubmitted, path } = params
  const link = `${baseUrl}${path}`
  const headline = resubmitted ? 'Ticket sent back for review' : 'New comment on a ticket'
  const action = resubmitted ? 'sent back for review' : 'commented on'
  await safeSend({
    to,
    subject: `Cash Box: ${authorName} ${action} "${concept}" — ${projectName}`,
    text: `${authorName} ${action} "${concept}" on ${projectName}${message ? `:\n\n${message}` : '.'}\n\n${link}`,
    html: renderEmailShell({
      preheader: `${authorName} ${action} "${concept}"`,
      bodyHtml: `
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111111;">${headline}</p>
<p style="margin:0 0 18px;color:#4b4844;"><b>${escapeHtml(authorName)}</b> ${action} a ticket on <b>${escapeHtml(projectName)}</b>.</p>
<div style="margin:0 0 22px;padding:14px 18px;background-color:#f7f6f3;border:1px solid #e5e3df;border-radius:8px;">
<div style="font-weight:600;color:#111111;margin-bottom:4px;">"${escapeHtml(concept)}"</div>
${message ? `<div style="color:#4b4844;font-size:13px;white-space:pre-wrap;">${escapeHtml(message)}</div>` : ''}
</div>
${emailButton('Open the ticket', link)}`,
    }),
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Weekly receipt-upload reminders (Wed/Fri, via the finance-reminders cron —
// see src/app/api/cron/finance-reminders/route.ts). Blasted to every active
// field user every week, no per-user "already uploaded?" check.
export async function emailReceiptReminderMidweek(baseUrl: string, to: string) {
  const link = `${baseUrl}/finance`
  await safeSend({
    to,
    subject: 'Cash Box: upload this week’s receipts before Friday',
    text: `Reminder: please upload this week's receipts before Friday.\n\n${link}`,
    html: renderEmailShell({
      preheader: 'Reminder: receipts are due before Friday',
      bodyHtml: `
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111111;">Receipt reminder</p>
<p style="margin:0 0 22px;color:#4b4844;">Please upload this week&apos;s receipts before Friday so Finance has time to review them.</p>
${emailButton('Upload receipts', link)}`,
    }),
  })
}

export async function emailReceiptReminderFriday(baseUrl: string, to: string) {
  const link = `${baseUrl}/finance`
  await safeSend({
    to,
    subject: 'Cash Box: today is the last day to upload this week’s receipts',
    text: `Today is the last day to upload receipts for this week.\n\n${link}`,
    html: renderEmailShell({
      preheader: 'Last day to upload this week’s receipts',
      bodyHtml: `
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111111;">Last day to upload</p>
<p style="margin:0 0 22px;color:#4b4844;">Today is the last day to upload receipts for this week &mdash; please get them in before the day ends.</p>
${emailButton('Upload receipts', link)}`,
    }),
  })
}

// What's waiting for Finance, for the Friday reminder below.
export interface ReviewBacklog {
  waiting: number
  overTwoWeeks: number
  oldestDays: number
  projects: { name: string; waiting: number; oldestDays: number }[]
}

// Fires alongside the Friday "last day to upload" field reminder — Finance
// gets nudged to go clear the review queue right as that week's window
// closes. Carries the backlog itself (client review, 26 Oct 2026: tickets
// had been waiting up to 49 days with nothing saying so).
export async function emailAdminReviewReminder(baseUrl: string, to: string, backlog: ReviewBacklog) {
  const link = `${baseUrl}/finance/admin/review`
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
  const summary = backlog.waiting === 0
    ? 'Nothing is waiting for review.'
    : `${backlog.waiting} ticket${backlog.waiting === 1 ? ' is' : 's are'} waiting for review${backlog.overTwoWeeks > 0 ? `, ${backlog.overTwoWeeks} for more than 14 days` : ''}. The oldest has waited ${days(backlog.oldestDays)}.`
  const lines = backlog.projects.map(p => `${p.name}: ${p.waiting} waiting, oldest ${days(p.oldestDays)}`)
  await safeSend({
    to,
    subject: backlog.waiting > 0 ? `Cash Box: ${backlog.waiting} ticket${backlog.waiting === 1 ? '' : 's'} waiting for review` : 'Cash Box: review queue is clear',
    text: `${summary}\n\n${lines.join('\n')}\n\n${link}`,
    html: renderEmailShell({
      preheader: summary,
      bodyHtml: `
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111111;">Review queue</p>
<p style="margin:0 0 18px;color:#4b4844;">${summary}</p>
${lines.length > 0 ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;width:100%;border-collapse:collapse;font-size:13px;">
${backlog.projects.map(p => `<tr><td style="padding:6px 0;border-bottom:1px solid #eeece7;color:#111111;">${escapeHtml(p.name)}</td><td style="padding:6px 0;border-bottom:1px solid #eeece7;color:#4b4844;text-align:right;">${p.waiting} waiting · oldest ${days(p.oldestDays)}</td></tr>`).join('')}
</table>` : ''}
${emailButton('Open the review queue', link)}`,
    }),
  })
}

async function safeSend(params: { to: string; subject: string; text: string; html: string }) {
  try {
    await sendEmail(params)
  } catch (err) {
    console.error('Finance notification email failed to send:', err)
  }
}

export async function emailCajaSubmitted(baseUrl: string, to: string[], projectName: string, weekNumber: number, cajaId: string) {
  const link = `${baseUrl}/finance/cajas/${cajaId}`
  await Promise.all(to.map(email => safeSend({
    to: email,
    subject: `Cash Box: ${projectName} — week ${weekNumber} submitted for review`,
    text: `${projectName}'s week ${weekNumber} caja has been submitted and is ready for your review: ${link}`,
    html: renderEmailShell({
      preheader: `${projectName} — week ${weekNumber} is ready for review`,
      bodyHtml: `
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111111;">Caja submitted for review</p>
<p style="margin:0 0 22px;color:#4b4844;"><b>${projectName}</b> — week ${weekNumber} has been submitted and is ready for your review.</p>
${emailButton('Open the caja review', link)}`,
    }),
  })))
}

export async function emailIncidentOpened(baseUrl: string, to: string, projectName: string, weekNumber: number, description: string, cajaId: string) {
  const link = `${baseUrl}/finance/cajas/${cajaId}`
  await safeSend({
    to,
    subject: `Cash Box: action needed on ${projectName} — week ${weekNumber}`,
    text: `Finance opened an incident on ${projectName}'s week ${weekNumber} caja: ${description}\n\n${link}`,
    html: renderEmailShell({
      preheader: `Action needed on ${projectName} — week ${weekNumber}`,
      bodyHtml: `
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111111;">Action needed</p>
<p style="margin:0 0 18px;color:#4b4844;">Finance opened an incident on <b>${projectName}</b>'s week ${weekNumber} caja:</p>
<div style="margin:0 0 22px;padding:14px 18px;background-color:#fdf7ea;border:1px solid #f0e0b0;border-radius:8px;color:#6b5410;font-size:13px;">${description}</div>
${emailButton('Open and reply', link)}`,
    }),
  })
}

const VERDICT_LABELS: Record<FinanceAuditVerdict, string> = {
  pass: 'Pass', pass_with_observations: 'Pass with observations', review_required: 'Review required', high_risk: 'High risk',
}

// The consolidated one-per-caja summary — this is the direct answer to
// "so we only check once per caja": Finance's whole review pass (every
// verify/reject decision plus the audit verdict) lands in a single email.
export async function emailCajaReviewComplete(params: {
  baseUrl: string
  to: string
  projectName: string
  weekNumber: number
  cajaId: string
  verifiedCount: number
  rejections: { concept: string; reason: string }[]
  auditVerdict: FinanceAuditVerdict | null
}) {
  const { baseUrl, to, projectName, weekNumber, cajaId, verifiedCount, rejections, auditVerdict } = params
  const link = `${baseUrl}/finance/cajas/${cajaId}`
  const verdictLine = auditVerdict ? `Audit verdict: ${VERDICT_LABELS[auditVerdict]}.` : ''
  const rejectionLines = rejections.map(r => `  - ${r.concept}: ${r.reason}`).join('\n')
  const rejectionHtml = rejections.map(r => `<li style="margin-bottom:4px;"><b>${r.concept}:</b> ${r.reason}</li>`).join('')

  await safeSend({
    to,
    subject: `Cash Box: ${projectName} — week ${weekNumber} reviewed`,
    text: `Finance has finished reviewing week ${weekNumber} for ${projectName}.\n\n${verifiedCount} expense(s) verified.\n${rejections.length > 0 ? `${rejections.length} rejected:\n${rejectionLines}\n` : ''}${verdictLine}\n\n${link}`,
    html: renderEmailShell({
      preheader: `${projectName} — week ${weekNumber} review complete`,
      bodyHtml: `
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111111;">Caja reviewed</p>
<p style="margin:0 0 18px;color:#4b4844;">Finance has finished reviewing week ${weekNumber} for <b>${projectName}</b>.</p>
<p style="margin:0 0 18px;color:#1a1a1a;">${verifiedCount} expense${verifiedCount === 1 ? '' : 's'} verified.${rejections.length > 0 ? ` ${rejections.length} rejected — see below.` : ''}</p>
${rejections.length > 0 ? `<div style="margin:0 0 18px;padding:14px 18px;background-color:#fdf2f2;border:1px solid #f3c6c6;border-radius:8px;color:#8a1f1f;font-size:13px;"><ul style="margin:0;padding-left:18px;">${rejectionHtml}</ul></div>` : ''}
${verdictLine ? `<p style="margin:0 0 18px;font-weight:600;color:#111111;">${verdictLine}</p>` : ''}
${emailButton('Open the caja', link)}`,
    }),
  })
}

export async function emailCajaApproved(baseUrl: string, to: string, projectName: string, weekNumber: number, cajaId: string) {
  const link = `${baseUrl}/finance/cajas/${cajaId}`
  await safeSend({
    to,
    subject: `Cash Box: ${projectName} — week ${weekNumber} approved`,
    text: `Week ${weekNumber} for ${projectName} has been approved. ${link}`,
    html: renderEmailShell({
      preheader: `${projectName} — week ${weekNumber} approved`,
      bodyHtml: `
<p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111111;">Caja approved</p>
<p style="margin:0 0 22px;color:#4b4844;">Week ${weekNumber} for <b>${projectName}</b> has been approved.</p>
${emailButton('View', link)}`,
    }),
  })
}
