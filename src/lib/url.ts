import type { NextRequest } from 'next/server'

// Resolves the public base URL used to build absolute links (e.g. invite links).
// Priority:
//   1. NEXT_PUBLIC_APP_URL — set this in prod to pin the canonical URL.
//   2. The incoming request's forwarded host/proto (correct behind proxies/Vercel).
//   3. request.nextUrl.origin as a last resort.
// Trailing slashes are stripped so callers can append `/path` cleanly.
export function getBaseUrl(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')

  const forwardedHost = request.headers.get('x-forwarded-host')
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') || 'https'
    return `${proto}://${forwardedHost}`.replace(/\/+$/, '')
  }

  return request.nextUrl.origin.replace(/\/+$/, '')
}
