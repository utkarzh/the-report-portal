import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Resolves the signed-in user for an API route, and — unlike a bare
// `supabase.auth.getUser()` — tells apart "not signed in" from "the sign-in
// service didn't answer".
//
// Why this exists (incident, 14 Sep 2026): a Sales Coach submission hung on
// the create request, then the retry got a clean 401 "Unauthorized", then a
// page reload worked — all within 47 minutes of a fresh login, with the same
// session accepted by Supabase Storage seconds earlier. Two library facts
// explain it: auth-js puts NO timeout on its call to Supabase Auth, so a slow
// answer hangs the route until the browser gives up (Safari reports that as
// "Load failed"); and it returns ANY failure to reach Auth — timeout, 5xx,
// dropped connection — as `{ user: null, error }`, which every route then
// reported as "Unauthorized". The user was never signed out.
//
// Here: the call is raced against a timeout, a transient failure becomes a
// 503 with `retryable: true` (the client retries once), and only a genuine
// auth rejection becomes a 401.
const AUTH_TIMEOUT_MS = 12_000

export type ApiUserResult =
  | { user: User; response?: undefined }
  | { user: null; response: NextResponse }

function unavailable(reason: string): NextResponse {
  console.error(`[api-user] Supabase Auth unavailable: ${reason}`)
  return NextResponse.json(
    { error: 'The sign-in service did not respond. Please try again in a moment.', retryable: true },
    { status: 503, headers: { 'Retry-After': '3' } },
  )
}

// A failure that says nothing about the session itself: the request to
// Supabase Auth never completed, or Auth answered with a server-side error.
function isTransient(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true
  const e = error as { name?: string; status?: number; message?: string }
  if (e.name === 'AuthRetryableFetchError') return true
  if (typeof e.status === 'number') return e.status === 0 || e.status === 429 || e.status >= 500
  // No HTTP status at all → a network-level failure, not an auth verdict.
  return true
}

export async function getApiUser(): Promise<ApiUserResult> {
  const supabase = createSupabaseServerClient()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), AUTH_TIMEOUT_MS)
  })
  try {
    const result = await Promise.race([supabase.auth.getUser(), timeout])
    if (result === 'timeout') return { user: null, response: unavailable(`no answer within ${AUTH_TIMEOUT_MS}ms`) }
    const { data, error } = result
    if (data?.user) return { user: data.user }
    if (isTransient(error)) {
      const e = error as { name?: string; status?: number; message?: string } | null
      return { user: null, response: unavailable(`${e?.name ?? 'unknown'} ${e?.status ?? ''} ${e?.message ?? ''}`.trim()) }
    }
    return { user: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  } catch (err) {
    // auth-js only THROWS for non-auth errors (see GoTrueClient._getUser) —
    // by definition not a verdict on the session.
    return { user: null, response: unavailable(err instanceof Error ? err.message : String(err)) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
