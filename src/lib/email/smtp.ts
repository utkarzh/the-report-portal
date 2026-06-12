import nodemailer, { type Transporter } from 'nodemailer'

// SMTP transport for outbound mail. Configured entirely via env so the provider
// (Google Workspace, a relay, etc.) can change without touching code:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//   SMTP_FROM            — From address (defaults to SMTP_USER)
//   OTP_DELIVERY_EMAIL   — fixed inbox that receives normal-user login codes
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

// The fixed inbox an admin monitors to relay codes to normal users.
export const OTP_DELIVERY_EMAIL =
  process.env.OTP_DELIVERY_EMAIL || 'editorial@the-report.com'

// Sends a normal user's one-time login code to the central editorial inbox.
// The code is NOT sent to the user themselves — a gatekeeper relays it manually.
export async function sendLoginCodeEmail(params: {
  code: string
  userEmail: string
}): Promise<void> {
  const { code, userEmail } = params
  const from = process.env.SMTP_FROM || process.env.SMTP_USER
  if (!from) throw new Error('SMTP_FROM / SMTP_USER is not configured')

  await getTransporter().sendMail({
    from,
    to: OTP_DELIVERY_EMAIL,
    subject: `Login code for ${userEmail}`,
    text:
      `A sign-in code was requested for the editorial-tool account:\n\n` +
      `  User:  ${userEmail}\n` +
      `  Code:  ${code}\n\n` +
      `Give this code to the user so they can finish signing in. ` +
      `It expires shortly and can only be used once.`,
    html:
      `<p>A sign-in code was requested for the editorial-tool account:</p>` +
      `<table cellpadding="6" style="font-family:system-ui,sans-serif;font-size:14px">` +
      `<tr><td><strong>User</strong></td><td>${userEmail}</td></tr>` +
      `<tr><td><strong>Code</strong></td><td style="font-size:20px;letter-spacing:2px"><strong>${code}</strong></td></tr>` +
      `</table>` +
      `<p style="font-family:system-ui,sans-serif;font-size:13px;color:#555">` +
      `Give this code to the user so they can finish signing in. ` +
      `It expires shortly and can only be used once.</p>`,
  })
}
