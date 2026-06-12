import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/url'

// GET /api/invite?token=xxx — public, used by invite page
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('invitations')
    .select('email, role, status, expires_at')
    .eq('token', token)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (data.status !== 'pending') {
    return NextResponse.json({ error: 'This invite link has expired or has already been used.' }, { status: 410 })
  }

  if (new Date(data.expires_at) < new Date()) {
    await supabaseAdmin.from('invitations').update({ status: 'expired' }).eq('token', token)
    return NextResponse.json({ error: 'This invite link has expired.' }, { status: 410 })
  }

  return NextResponse.json({ email: data.email, role: data.role })
}

// POST /api/invite — admin only, creates invite
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { email, role, tokenLimit, fullName } = body

  if (!email || !role) {
    return NextResponse.json({ error: 'email and role are required' }, { status: 400 })
  }

  // Check for existing pending invite
  const { data: existing } = await supabaseAdmin
    .from('invitations')
    .select('id')
    .eq('email', email)
    .eq('status', 'pending')
    .single()

  if (existing) {
    return NextResponse.json({ error: 'A pending invite already exists for this email.' }, { status: 409 })
  }

  const { data: invite, error: insertError } = await supabaseAdmin
    .from('invitations')
    .insert({
      email,
      role,
      // Admins are never token-limited — store NULL ("no limit"). Normal users
      // fall back to the 2M default when no limit is supplied.
      token_limit: role === 'admin' ? null : (tokenLimit || 2000000),
      invited_by: user.id,
    })
    .select('id, token')
    .single()

  if (insertError || !invite) {
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }

  // Admins set a password, so they go through the invite-link → signup flow.
  if (role === 'admin') {
    const inviteUrl = `${getBaseUrl(request)}/invite/${invite.token}`
    return NextResponse.json({ method: 'invite', inviteUrl }, { status: 201 })
  }

  // Normal users never sign up or set a password — they log in with a one-time
  // code. Create their (passwordless) account now; the handle_new_user trigger
  // reads this pending invitation to set the role + token limit and marks it
  // accepted. email_confirm lets them sign in immediately.
  const { error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: (fullName || '').trim() },
  })

  if (createError) {
    // Roll back the invitation so a failed create doesn't leave a dangling row.
    await supabaseAdmin.from('invitations').delete().eq('id', invite.id)
    const exists = /already|registered|exists/i.test(createError.message)
    return NextResponse.json(
      { error: exists ? 'An account with this email already exists.' : 'Failed to create the user account.' },
      { status: exists ? 409 : 500 },
    )
  }

  return NextResponse.json({ method: 'created', email }, { status: 201 })
}
