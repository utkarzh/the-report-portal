import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { recordLoginAudit, type LoginMethod } from '@/lib/audit'

// Name of the cookie that mirrors profiles.active_session_id on the browser.
// Middleware compares the two; a mismatch means this device is a stale login
// and gets signed out ("newest login wins").
const DEVICE_SESSION_COOKIE = 'device_session'

// One year — the cookie only needs to outlive the auth session. It carries no
// secret material (just an opaque id that must match the DB), so a long life is
// fine; it's replaced on every fresh sign-in anyway.
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365

// POST /api/auth/session-register — called by the client immediately after a
// successful sign-in (password or OTP). It claims the account's single active
// device slot: a fresh session id is written to profiles.active_session_id and
// mirrored into the httpOnly `device_session` cookie on this response. Any
// other device still holding the previous id is signed out by the middleware on
// its next request. This enforces one-device-one-login for all roles.
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const sessionId = randomUUID()

  const { data: profile, error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ active_session_id: sessionId })
    .eq('id', user.id)
    .select('email, full_name, role')
    .single()

  if (updateError) {
    console.error('Failed to register device session:', updateError)
    return NextResponse.json(
      { error: 'Could not register this device. Please try again.' },
      { status: 500 },
    )
  }

  // Record the login in the admin-only audit trail. Geolocation now comes from
  // Vercel's edge headers (no external call), so this is just one fast insert —
  // we AWAIT it so the row is guaranteed written before the response returns.
  // (Fire-and-forget was unreliable on serverless: the function could freeze
  // after responding and drop the pending write.) recordLoginAudit never throws.
  const body = await request.json().catch(() => ({} as { method?: string }))
  const method: LoginMethod | null =
    body?.method === 'password' || body?.method === 'otp' ? body.method : null

  await recordLoginAudit({
    userId: user.id,
    email: profile?.email ?? user.email ?? '',
    fullName: profile?.full_name ?? null,
    role: profile?.role ?? null,
    headers: request.headers,
    method,
  })

  const response = NextResponse.json({ ok: true })
  response.cookies.set(DEVICE_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  })
  return response
}
