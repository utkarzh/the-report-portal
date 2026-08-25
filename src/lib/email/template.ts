// Shared HTML shell for every outbound transactional email — a branded,
// table-based layout with inline styles only, so it renders consistently
// across Gmail/Outlook/Apple Mail instead of the old single unstyled <div>.
//
// The header is a TEXT wordmark, not an image. An <img> logo referenced by
// URL depends on the recipient's client actually fetching it — webmail
// proxies (Gmail's included) can't reach a local dev URL, and plenty of
// clients block remote images by default anyway, so it read as broken/blank
// far too often. Text always renders; this mirrors the real logo.png's look
// (serif wordmark, white on black, red period) closely enough with zero
// network dependency.
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const SERIF_STACK = "Georgia,'Times New Roman',Times,serif"

export function renderEmailShell(params: { preheader: string; bodyHtml: string }): string {
  const { preheader, bodyHtml } = params

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>The Report Company</title>
</head>
<body style="margin:0;padding:0;background-color:#f0efec;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0efec;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-collapse:collapse;">
<tr><td style="height:4px;line-height:4px;font-size:0;background-color:#db3030;">&nbsp;</td></tr>
<tr><td style="background-color:#000000;padding:26px 32px;">
<span style="font-family:${SERIF_STACK};font-size:22px;color:#ffffff;letter-spacing:0.2px;">The Report Company<span style="color:#db3030;">.</span></span>
</td></tr>
<tr><td style="padding:36px 32px;font-family:${FONT_STACK};color:#1a1a1a;font-size:14px;line-height:1.6;">
${bodyHtml}
</td></tr>
<tr><td style="padding:18px 32px 28px;border-top:1px solid #e5e3df;font-family:${FONT_STACK};font-size:11px;color:#9a9690;">
The Report Company — Editorial &amp; Cash Box Platform<br />
This is an automated message — please don't reply directly to this email.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

// A black pill CTA — table-wrapped because Outlook's rendering engine
// ignores padding/border-radius set directly on an <a>.
export function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 0;"><tr><td style="background-color:#000000;border-radius:6px;"><a href="${href}" style="display:inline-block;padding:11px 22px;font-family:${FONT_STACK};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a></td></tr></table>`
}
