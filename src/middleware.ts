import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessInterview, canAccessTranscriptions, landingPathFor } from '@/lib/access'
import type { UserRole } from '@/types'

// Normal users are automatically signed out 10 days after they last signed in.
// Admins have no session-age limit. `last_sign_in_at` is set by Supabase at
// sign-in and is NOT touched by refresh-token rotation, so it reflects the
// actual login time, not the last request.
const USER_SESSION_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000 // 10 days

function isSessionExpiredForUser(role: string, lastSignInAt: string | null | undefined) {
  if (role === 'admin' || !lastSignInAt) return false
  return Date.now() - new Date(lastSignInAt).getTime() > USER_SESSION_MAX_AGE_MS
}

// One-device-one-login: the browser's device_session cookie must match the
// account's currently-authorised session id. A fresh sign-in on another device
// rewrites active_session_id, so this device's cookie no longer matches and it
// is signed out ("newest login wins"). Enforcement is skipped until a device has
// registered (active_session_id NULL) so pre-existing sessions aren't cut off
// until their next sign-in.
const DEVICE_SESSION_COOKIE = 'device_session'

function isStaleDevice(
  activeSessionId: string | null | undefined,
  cookieSessionId: string | undefined,
) {
  if (!activeSessionId) return false
  return cookieSessionId !== activeSessionId
}

// Deletes all Supabase session cookies (plus the device_session cookie) on the
// redirect response so the browser doesn't re-send them on the next request
// (which would restart the loop).
function clearAuthCookies(response: NextResponse, request: NextRequest) {
  request.cookies.getAll().forEach(({ name }) => {
    if (name.startsWith('sb-')) {
      response.cookies.delete(name)
    }
  })
  response.cookies.delete(DEVICE_SESSION_COOKIE)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublicRoute = pathname.startsWith('/login') || pathname.startsWith('/invite')

  let pendingCookies: { name: string; value: string; options: CookieOptions }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          pendingCookies = cookiesToSet
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && (pathname === '/login' || pathname.startsWith('/invite'))) {
    // Before redirecting an authenticated user to /dashboard, verify they're active.
    // If inactive, clear cookies right here so we don't loop through /dashboard.
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, role, active_session_id')
      .eq('id', user.id)
      .single()

    if (!profile || profile.status === 'inactive') {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = pathname === '/login' ? request.nextUrl.search : '?error=account_deactivated'
      const redirect = NextResponse.redirect(url)
      clearAuthCookies(redirect, request)
      return redirect
    }

    if (isSessionExpiredForUser(profile.role, user.last_sign_in_at)) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = '?error=session_expired'
      const redirect = NextResponse.redirect(url)
      clearAuthCookies(redirect, request)
      return redirect
    }

    if (isStaleDevice(profile.active_session_id, request.cookies.get(DEVICE_SESSION_COOKIE)?.value)) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = '?error=signed_in_elsewhere'
      const redirect = NextResponse.redirect(url)
      clearAuthCookies(redirect, request)
      return redirect
    }

    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  const requestHeaders = new Headers(request.headers)
  for (const key of ['x-user-id', 'x-user-role', 'x-user-name', 'x-user-tokens-used', 'x-user-token-limit', 'x-user-can-interview', 'x-user-can-transcriptions']) {
    requestHeaders.delete(key)
  }

  if (user && !isPublicRoute) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, status, full_name, tokens_used, token_limit, active_session_id, can_access_interview, can_access_transcriptions')
      .eq('id', user.id)
      .single()

    if (!profile) {
      // Orphaned auth account — no profile row. Clear cookies and send to login.
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      const redirect = NextResponse.redirect(url)
      clearAuthCookies(redirect, request)
      return redirect
    }

    if (profile.status === 'inactive') {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = '?error=account_deactivated'
      const redirect = NextResponse.redirect(url)
      clearAuthCookies(redirect, request)
      return redirect
    }

    if (isSessionExpiredForUser(profile.role, user.last_sign_in_at)) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = '?error=session_expired'
      const redirect = NextResponse.redirect(url)
      clearAuthCookies(redirect, request)
      return redirect
    }

    if (isStaleDevice(profile.active_session_id, request.cookies.get(DEVICE_SESSION_COOKIE)?.value)) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = '?error=signed_in_elsewhere'
      const redirect = NextResponse.redirect(url)
      clearAuthCookies(redirect, request)
      return redirect
    }

    if (pathname.startsWith('/admin') && profile.role !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }

    // Per-module access. Admins bypass; normal users are redirected to their
    // allowed landing page if they hit a module they don't have access to.
    const access = {
      role: profile.role as UserRole,
      can_access_interview: profile.can_access_interview,
      can_access_transcriptions: profile.can_access_transcriptions,
    }
    const blockedFromInterview = pathname.startsWith('/interview') && !canAccessInterview(access)
    const blockedFromTranscriptions = pathname.startsWith('/transcriptions') && !canAccessTranscriptions(access)
    if (blockedFromInterview || blockedFromTranscriptions) {
      const url = request.nextUrl.clone()
      url.pathname = landingPathFor(access)
      url.search = ''
      return NextResponse.redirect(url)
    }

    requestHeaders.set('x-user-id', user.id)
    requestHeaders.set('x-user-role', profile.role)
    requestHeaders.set('x-user-name', profile.full_name ?? '')
    requestHeaders.set('x-user-tokens-used', String(profile.tokens_used))
    requestHeaders.set('x-user-token-limit', String(profile.token_limit))
    // Effective access (admins always true) — read by getProfileFromHeaders.
    requestHeaders.set('x-user-can-interview', String(canAccessInterview(access)))
    requestHeaders.set('x-user-can-transcriptions', String(canAccessTranscriptions(access)))
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)',],
}
