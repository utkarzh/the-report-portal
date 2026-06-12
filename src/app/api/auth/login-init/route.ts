import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendLoginCodeEmail } from '@/lib/email/smtp'

// POST /api/auth/login-init — first step of the smart login form.
// Given an email, decides how the user signs in:
//   - admin        → { method: 'password' }  (client reveals the password field)
//   - normal user  → mints a one-time code, emails it to the editorial inbox,
//                     and returns { method: 'otp' }. The code is relayed to the
//                     user manually; it is never sent to the user's own address.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const rawEmail = (body?.email || '') as string
  const email = rawEmail.trim().toLowerCase()

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status')
    .eq('email', email)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json(
      { error: 'No account found for this email.' },
      { status: 404 },
    )
  }

  if (profile.status === 'inactive') {
    return NextResponse.json(
      { error: 'Your account has been deactivated. Please contact an administrator.' },
      { status: 403 },
    )
  }

  // Admins authenticate with their password.
  if (profile.role === 'admin') {
    return NextResponse.json({ method: 'password' })
  }

  // Normal users: generate a Supabase one-time code and email it to the central
  // editorial inbox for manual relay. generateLink mints the code WITHOUT
  // sending any email itself, which is exactly what we want here.
  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  const code = link?.properties?.email_otp
  if (linkError || !code) {
    console.error('Failed to generate login code:', linkError)
    return NextResponse.json(
      { error: 'Could not start sign-in. Please try again.' },
      { status: 500 },
    )
  }

  try {
    await sendLoginCodeEmail({ code, userEmail: email })
  } catch (err) {
    console.error('Failed to send login code email:', err)
    return NextResponse.json(
      { error: 'Could not send the login code. Please contact an administrator.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ method: 'otp' })
}
