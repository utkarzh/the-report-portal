import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// POST /api/signup — called from the invite page
// Uses the admin API so the new user is email-confirmed immediately (no confirmation email needed)
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { token, fullName, password } = body

  if (!token || !password || !fullName) {
    return NextResponse.json({ error: 'token, fullName, and password are required' }, { status: 400 })
  }

  // Validate the invite token
  const { data: invite, error: inviteError } = await supabaseAdmin
    .from('invitations')
    .select('email, role, token_limit, status, expires_at')
    .eq('token', token)
    .single()

  if (inviteError || !invite) {
    return NextResponse.json({ error: 'Invalid invite link.' }, { status: 404 })
  }

  if (invite.status !== 'pending') {
    return NextResponse.json({ error: 'This invite link has already been used.' }, { status: 410 })
  }

  if (new Date(invite.expires_at) < new Date()) {
    await supabaseAdmin.from('invitations').update({ status: 'expired' }).eq('token', token)
    return NextResponse.json({ error: 'This invite link has expired.' }, { status: 410 })
  }

  // Create the user with email already confirmed — no confirmation email sent
  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (createError || !newUser.user) {
    return NextResponse.json({ error: createError?.message || 'Failed to create account.' }, { status: 500 })
  }

  return NextResponse.json({ email: invite.email })
}
