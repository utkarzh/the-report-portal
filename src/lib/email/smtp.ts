import nodemailer, { type Transporter } from 'nodemailer'

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

// Sends a one-time login code directly to the user who requested it.
export async function sendLoginCodeEmail(params: {
  code: string
  userEmail: string
}): Promise<void> {
  const { code, userEmail } = params
  const from = process.env.SMTP_FROM || process.env.SMTP_USER
  if (!from) throw new Error('SMTP_FROM / SMTP_USER is not configured')

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
    html:
      `<p style="font-family:system-ui,sans-serif;font-size:14px">Here is your one-time login code for the editorial tool:</p>` +
      `<p style="font-family:system-ui,sans-serif;font-size:28px;letter-spacing:4px;font-weight:600">${code}</p>` +
      `<p style="font-family:system-ui,sans-serif;font-size:13px;color:#555">` +
      `Enter it on the sign-in page to finish signing in. ` +
      `It expires shortly and can only be used once. ` +
      `If you didn't request this, you can ignore this email.</p>`,
  })
}
