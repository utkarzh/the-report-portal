import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessInterview, canAccessTranscriptions, canAccessBusinessCases, canAccessEditorialBriefs, canAccessMeetingPreparation, canAccessInterviewLetterGenerator, canAccessSalesNegotiationCoach, canAccessFinance, isFinanceAdmin, landingPathFor } from '@/lib/access'
import { PROFILE_CACHE_COOKIE, PROFILE_CACHE_TTL_MS, signProfileCache, verifyProfileCache, type CachedProfile } from '@/lib/auth/profile-cache'
import type { UserRole, FinanceRole } from '@/types'

// Unset by default: caching is opt-in (see profile-cache.ts) so a deployment
// without this env var behaves exactly as before — always a live DB check.
const MIDDLEWARE_CACHE_SECRET = process.env.MIDDLEWARE_CACHE_SECRET

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

// auth-js puts no timeout on its call to Supabase Auth (see src/lib/auth/api-user.ts
// for the incident this same gap caused on API routes). Middleware runs on every
// page navigation, so an unbounded getSession() here can stall the whole app rather
// than just one request. Race it and treat a stall as "can't verify right now"
// rather than hanging indefinitely.
const AUTH_TIMEOUT_MS = 8_000

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
  response.cookies.delete(PROFILE_CACHE_COOKIE)
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

  // Copy any refreshed Supabase auth cookies onto a response. Supabase rotates
  // the refresh token during getSession(); if we DON'T write the new cookies to
  // whatever response we return (including redirects), the browser keeps the old
  // — now-invalidated — token and the very next request bounces to /login. This
  // caused intermittent "have to log in again" loops. Every non-logout response
  // must go through this. (Logout responses intentionally clear cookies instead.)
  const applyCookies = (response: NextResponse) => {
    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options)
    })
    return response
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), AUTH_TIMEOUT_MS)
  })
  const sessionResult = await Promise.race([supabase.auth.getSession(), timeout])
  clearTimeout(timer)

  if (sessionResult === 'timeout') {
    console.error('[middleware] Supabase Auth unavailable: no answer within', AUTH_TIMEOUT_MS, 'ms')
    if (isPublicRoute) {
      // Can't tell if they're already signed in — just render the public page.
      return NextResponse.next()
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = '?error=service_unavailable'
    return NextResponse.redirect(url)
  }

  const { data: { session } } = sessionResult
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
    return applyCookies(NextResponse.redirect(url))
  }

  const requestHeaders = new Headers(request.headers)
  for (const key of ['x-user-id', 'x-user-role', 'x-user-name', 'x-user-tokens-used', 'x-user-token-limit', 'x-user-can-interview', 'x-user-can-transcriptions', 'x-user-can-business-cases', 'x-user-can-editorial-briefs', 'x-user-can-meeting-preparation', 'x-user-can-interview-letters', 'x-user-can-sales-coach', 'x-user-finance-role']) {
    requestHeaders.delete(key)
  }

  if (user && !isPublicRoute) {
    let profile: CachedProfile | null = MIDDLEWARE_CACHE_SECRET
      ? await verifyProfileCache(request.cookies.get(PROFILE_CACHE_COOKIE)?.value, MIDDLEWARE_CACHE_SECRET, user.id)
      : null

    if (!profile) {
      const { data: freshProfile } = await supabase
        .from('profiles')
        .select('role, status, full_name, tokens_used, token_limit, active_session_id, can_access_interview, can_access_transcriptions, can_access_business_cases, can_access_editorial_briefs, can_access_meeting_preparation, can_access_interview_letter_generator, can_access_sales_negotiation_coach, finance_role')
        .eq('id', user.id)
        .single()

      if (freshProfile) {
        profile = { ...freshProfile, user_id: user.id, iat: Date.now() }
        if (MIDDLEWARE_CACHE_SECRET) {
          const signed = await signProfileCache(profile, MIDDLEWARE_CACHE_SECRET)
          pendingCookies.push({
            name: PROFILE_CACHE_COOKIE,
            value: signed,
            options: {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
              maxAge: Math.ceil(PROFILE_CACHE_TTL_MS / 1000),
            },
          })
        }
      }
    }

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
      return applyCookies(NextResponse.redirect(url))
    }

    // Per-module access. Admins bypass; normal users are redirected to their
    // allowed landing page if they hit a module they don't have access to.
    const access = {
      role: profile.role as UserRole,
      can_access_interview: profile.can_access_interview,
      can_access_transcriptions: profile.can_access_transcriptions,
      can_access_business_cases: profile.can_access_business_cases,
      can_access_editorial_briefs: profile.can_access_editorial_briefs,
      can_access_meeting_preparation: profile.can_access_meeting_preparation,
      can_access_interview_letter_generator: profile.can_access_interview_letter_generator,
      can_access_sales_negotiation_coach: profile.can_access_sales_negotiation_coach,
      finance_role: profile.finance_role as FinanceRole,
    }
    const blockedFromInterview = pathname.startsWith('/interview') && !pathname.startsWith('/interview-letters') && !canAccessInterview(access)
    const blockedFromTranscriptions = pathname.startsWith('/transcriptions') && !canAccessTranscriptions(access)
    const blockedFromBusinessCases = pathname.startsWith('/business-cases') && !canAccessBusinessCases(access)
    const blockedFromEditorialBriefs = pathname.startsWith('/editorial-briefs') && !canAccessEditorialBriefs(access)
    const blockedFromMeetingPreparation = pathname.startsWith('/meeting-preparation') && !canAccessMeetingPreparation(access)
    const blockedFromInterviewLetters = pathname.startsWith('/interview-letters') && !canAccessInterviewLetterGenerator(access)
    const blockedFromSalesCoach = pathname.startsWith('/sales-coach') && !canAccessSalesNegotiationCoach(access)
    // /finance/admin needs finance-admin (or platform admin); plain /finance
    // needs any finance access at all.
    const blockedFromFinanceAdmin = pathname.startsWith('/finance/admin') && !isFinanceAdmin(access)
    const blockedFromFinance = pathname.startsWith('/finance') && !pathname.startsWith('/finance/admin') && !canAccessFinance(access)
    if (blockedFromInterview || blockedFromTranscriptions || blockedFromBusinessCases || blockedFromEditorialBriefs || blockedFromMeetingPreparation || blockedFromInterviewLetters || blockedFromSalesCoach || blockedFromFinanceAdmin || blockedFromFinance) {
      const url = request.nextUrl.clone()
      url.pathname = landingPathFor(access)
      url.search = ''
      return applyCookies(NextResponse.redirect(url))
    }

    requestHeaders.set('x-user-id', user.id)
    requestHeaders.set('x-user-role', profile.role)
    requestHeaders.set('x-user-name', profile.full_name ?? '')
    requestHeaders.set('x-user-tokens-used', String(profile.tokens_used))
    requestHeaders.set('x-user-token-limit', String(profile.token_limit))
    // Effective access (admins always true) — read by getProfileFromHeaders.
    requestHeaders.set('x-user-can-interview', String(canAccessInterview(access)))
    requestHeaders.set('x-user-can-transcriptions', String(canAccessTranscriptions(access)))
    requestHeaders.set('x-user-can-business-cases', String(canAccessBusinessCases(access)))
    requestHeaders.set('x-user-can-editorial-briefs', String(canAccessEditorialBriefs(access)))
    requestHeaders.set('x-user-can-meeting-preparation', String(canAccessMeetingPreparation(access)))
    requestHeaders.set('x-user-can-interview-letters', String(canAccessInterviewLetterGenerator(access)))
    requestHeaders.set('x-user-can-sales-coach', String(canAccessSalesNegotiationCoach(access)))
    requestHeaders.set('x-user-finance-role', profile.finance_role ?? '')
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
