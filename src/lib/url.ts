import type { NextRequest } from 'next/server'

// Resolves the public base URL used to build absolute links (e.g. invite links).
// Priority:
//   1. NEXT_PUBLIC_APP_URL — set this in prod to pin the canonical URL.
//   2. The incoming request's forwarded host/proto (correct behind proxies/Vercel).
//   3. request.nextUrl.origin as a last resort.
// Trailing slashes are stripped so callers can append `/path` cleanly.
export function getBaseUrl(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (fromEnv) {
    // A bare domain (no scheme) is a natural way to fill in this env var, but
    // used as-is it produces a scheme-less <a href> — undefined/broken in an
    // email client with no page to resolve it relative to. Default to https.
    const withScheme = /^https?:\/\//i.test(fromEnv) ? fromEnv : `https://${fromEnv}`
    return withScheme.replace(/\/+$/, '')
  }

  const forwardedHost = request.headers.get('x-forwarded-host')
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') || 'https'
    return `${proto}://${forwardedHost}`.replace(/\/+$/, '')
  }

  return request.nextUrl.origin.replace(/\/+$/, '')
}
