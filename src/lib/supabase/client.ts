'use client'

import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowserClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}

// Guards a long client-side flow (audio transcoding, a large direct-to-storage
// upload) that can easily outlast the ~1h access token. supabase-js refreshes
// on a background timer, but a CPU-heavy step (ffmpeg.wasm) or a backgrounded
// tab (Safari throttles inactive-tab timers hard) can make that timer fire too
// late — the token then expires mid-flow with nothing having proactively
// refreshed it.
//
// Symptom without this: the upload or the next API call fails with a raw
// network error (Safari: "Load failed"; Chrome: "Failed to fetch") because the
// request carried an expired token; retrying immediately just resends the same
// stale cookie and gets a clean 401 "Unauthorized" from the API route; only a
// full page reload (which re-hydrates the session from the stored refresh
// token) fixes it. Call this right before each step that needs a valid
// session in a multi-minute flow — after transcoding finishes and again right
// before the final API call — so the refresh happens proactively instead of
// the user hitting the failure.
//
// Throws a clear, user-facing message if there's no session or the refresh
// token itself is no longer valid (truly signed out elsewhere) — there's
// nothing left to retry in that case.
export async function ensureFreshSession(supabase: ReturnType<typeof getSupabaseBrowserClient>): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new Error('You have been signed out. Please sign in again and retry.')
  }
  const expiresAtMs = (session.expires_at ?? 0) * 1000
  const REFRESH_BUFFER_MS = 2 * 60 * 1000
  if (expiresAtMs - Date.now() > REFRESH_BUFFER_MS) return // still comfortably valid

  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session) {
    throw new Error('Your session has expired. Please sign in again and retry.')
  }
}
