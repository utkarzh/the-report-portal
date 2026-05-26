import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

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
  const { email, role, tokenLimit } = body

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
      token_limit: tokenLimit || 100000,
      invited_by: user.id,
    })
    .select('token')
    .single()

  if (insertError || !invite) {
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${invite.token}`
  return NextResponse.json({ inviteUrl }, { status: 201 })
}
