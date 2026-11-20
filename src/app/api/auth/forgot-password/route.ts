import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendPasswordResetEmail } from '@/lib/email/smtp'
import { getBaseUrl } from '@/lib/url'

// POST /api/auth/forgot-password { email } — starts an admin password reset.
//
// Only admins sign in with a password (normal users get an emailed code), so a
// reset link is sent only to an active admin account. Like the login code, the
// token is minted with admin.generateLink (which sends no email itself) and
// delivered through our SMTP. The link carries the token's hash to
// /reset-password, which checks it with verifyOtp only when the new password is
// submitted, so an email scanner opening the link can't use it up.
//
// The reply is the same whatever the email, so this endpoint never confirms
// whether an account exists or what kind it is. A second request for the same
// account within RESEND_COOLDOWN_MS sends nothing (Supabase records
// recovery_sent_at on the user), which stops it being used to flood an inbox.
const RESEND_COOLDOWN_MS = 60_000
const GENERIC_REPLY = { ok: true }

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const email = String(body?.email || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, full_name')
    .eq('email', email)
    .maybeSingle()

  if (!profile || profile.role !== 'admin' || profile.status === 'inactive') {
    return NextResponse.json(GENERIC_REPLY)
  }

  const { data: existing } = await supabaseAdmin.auth.admin.getUserById(profile.id)
  const lastSent = existing?.user?.recovery_sent_at ? Date.parse(existing.user.recovery_sent_at) : 0
  if (lastSent && Date.now() - lastSent < RESEND_COOLDOWN_MS) {
    return NextResponse.json(GENERIC_REPLY)
  }

  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) {
    console.error('[forgot-password] could not create a recovery token:', linkError)
    return NextResponse.json({ error: 'Could not start the password reset. Please try again.' }, { status: 500 })
  }

  const resetUrl = `${getBaseUrl(request)}/reset-password?token=${encodeURIComponent(tokenHash)}`
  try {
    await sendPasswordResetEmail({ resetUrl, userEmail: email, name: profile.full_name })
  } catch (err) {
    console.error('[forgot-password] could not send the reset email:', err)
    return NextResponse.json({ error: 'Could not send the reset email. Please try again or contact an administrator.' }, { status: 502 })
  }

  return NextResponse.json(GENERIC_REPLY)
}
