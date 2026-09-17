// Middleware runs on every page navigation and, until now, always paid a live
// Postgres round-trip (~100-400ms depending on network path) to re-check the
// user's profile — role, status, one-device-login session id, per-module
// permissions, token counts — purely to inject it into request headers and
// enforce access. That round-trip is what made navigation feel inconsistent.
//
// This caches that profile in a short-TTL, HMAC-signed cookie so most
// navigations skip the DB entirely. The signature means a client can't forge
// or extend it themselves (tampering just invalidates it, forcing a live
// re-check) — the only thing traded away is staleness bounded by
// PROFILE_CACHE_TTL_MS: a deactivation or a "signed in elsewhere" kick-out can
// take up to that long to take effect instead of being instant on the very
// next click. Explicitly accepted for this app (not a banking tool) — see
// CLAUDE.md. Caching is OFF unless MIDDLEWARE_CACHE_SECRET is set, so an
// unconfigured deployment behaves exactly as before (always-live check).
export const PROFILE_CACHE_COOKIE = 'profile_cache'
export const PROFILE_CACHE_TTL_MS = 20_000

export interface CachedProfile {
  user_id: string
  role: string
  status: string
  full_name: string | null
  tokens_used: number
  token_limit: number
  active_session_id: string | null
  can_access_interview: boolean
  can_access_transcriptions: boolean
  can_access_business_cases: boolean
  can_access_editorial_briefs: boolean
  can_access_meeting_preparation: boolean
  can_access_interview_letter_generator: boolean
  can_access_sales_negotiation_coach: boolean
  finance_role: string | null
  iat: number
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function signProfileCache(profile: CachedProfile, secret: string): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(profile)))
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`
}

// Returns the cached profile only if the signature is valid, it belongs to
// this exact user (guards against a stale cookie surviving a user switch on a
// shared browser), and it's within the TTL. Anything else — missing, tampered,
// wrong user, expired, malformed — returns null so the caller falls back to a
// live query.
export async function verifyProfileCache(
  cookieValue: string | undefined,
  secret: string,
  userId: string,
): Promise<CachedProfile | null> {
  if (!cookieValue) return null
  const dot = cookieValue.lastIndexOf('.')
  if (dot < 0) return null
  const payload = cookieValue.slice(0, dot)
  const sig = cookieValue.slice(dot + 1)
  try {
    const key = await hmacKey(secret)
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(sig) as BufferSource, new TextEncoder().encode(payload))
    if (!valid) return null
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as CachedProfile
    if (decoded.user_id !== userId) return null
    if (Date.now() - decoded.iat > PROFILE_CACHE_TTL_MS) return null
    return decoded
  } catch {
    return null
  }
}
