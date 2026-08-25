import nodemailer, { type Transporter } from 'nodemailer'
import { renderEmailShell } from './template'

// SMTP transport for outbound mail. Configured entirely via env so the provider
// (Google Workspace, a relay, etc.) can change without touching code:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//   SMTP_FROM            — From address (defaults to SMTP_USER)
let transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (!transporter) {
    const host = process.env.SMTP_HOST
    const port = Number(process.env.SMTP_PORT || 587)
    if (!host) throw new Error('SMTP_HOST is not configured')
    transporter = nodemailer.createTransport({
      host,
      port,
      // 465 = implicit TLS; 587/25 = STARTTLS (secure: false, upgraded by the server)
      secure: port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  }
  return transporter
}

// Generic send, for any module that needs to email a real notification (not
// just the auth OTP flow below). Callers should keep messages infrequent and
// genuinely useful — this has no batching/throttling built in.
export async function sendEmail(params: {
  to: string
  subject: string
  text: string
  html: string
}): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER
  if (!from) throw new Error('SMTP_FROM / SMTP_USER is not configured')
  await getTransporter().sendMail({ from, to: params.to, subject: params.subject, text: params.text, html: params.html })
}

// Sends a one-time login code directly to the user who requested it.
export async function sendLoginCodeEmail(params: {
  code: string
  userEmail: string
  baseUrl: string
}): Promise<void> {
  const { code, userEmail, baseUrl } = params
  const from = process.env.SMTP_FROM || process.env.SMTP_USER
  if (!from) throw new Error('SMTP_FROM / SMTP_USER is not configured')

  const html = renderEmailShell({
    preheader: `Your sign-in code is ${code}`,
    bodyHtml: `
<p style="margin:0 0 18px;font-size:15px;font-weight:600;color:#111111;">Your sign-in code</p>
<p style="margin:0 0 20px;color:#4b4844;">Enter this code on the sign-in page to finish signing in to the editorial tool.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
<tr><td align="center" style="background-color:#f0efec;border:1px solid #e5e3df;border-radius:8px;padding:22px;">
<span style="font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:#111111;">${code}</span>
</td></tr>
</table>
<p style="margin:0;color:#8a867f;font-size:12.5px;">This code expires shortly and can only be used once. If you didn't request it, you can safely ignore this email.</p>`,
  })

  await getTransporter().sendMail({
    from,
    to: userEmail,
    subject: `Your editorial-tool login code`,
    text:
      `Here is your one-time login code for the editorial tool:\n\n` +
      `  ${code}\n\n` +
      `Enter it on the sign-in page to finish signing in. ` +
      `It expires shortly and can only be used once. ` +
      `If you didn't request this, you can ignore this email.`,
    html,
  })
}
