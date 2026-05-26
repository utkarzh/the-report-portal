import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Deletes all Supabase session cookies on the redirect response so the browser
// doesn't re-send them on the next request (which would restart the loop).
function clearAuthCookies(response: NextResponse, request: NextRequest) {
  request.cookies.getAll().forEach(({ name }) => {
    if (name.startsWith('sb-')) {
      response.cookies.delete(name)
    }
  })
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
      .select('status')
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

    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  const requestHeaders = new Headers(request.headers)
  for (const key of ['x-user-id', 'x-user-role', 'x-user-name', 'x-user-tokens-used', 'x-user-token-limit']) {
    requestHeaders.delete(key)
  }

  if (user && !isPublicRoute) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, status, full_name, tokens_used, token_limit')
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

    if (pathname.startsWith('/admin') && profile.role !== 'admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }

    requestHeaders.set('x-user-id', user.id)
    requestHeaders.set('x-user-role', profile.role)
    requestHeaders.set('x-user-name', profile.full_name ?? '')
    requestHeaders.set('x-user-tokens-used', String(profile.tokens_used))
    requestHeaders.set('x-user-token-limit', String(profile.token_limit))
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)',],
}
