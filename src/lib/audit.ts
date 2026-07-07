import { supabaseAdmin } from '@/lib/supabase/admin'

// Best-effort login audit trail. Every successful sign-in writes one row via
// recordLoginAudit(). Nothing here may throw into the login path — capturing an
// audit event must never block or fail a user's sign-in, so all work is wrapped
// and failures are logged and swallowed.

export type LoginMethod = 'password' | 'otp'

// Pull the client IP from the proxy headers Vercel/Next set in front of the app.
// `x-forwarded-for` is a comma-separated list; the left-most entry is the client.
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip') || null
}

// A private / loopback / link-local address won't geolocate — skip the lookup
// for those (common in local dev) rather than waste a round-trip.
function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('127.') || ip === 'localhost') return true
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1])
    if (second >= 16 && second <= 31) return true
  }
  // IPv6 unique-local / link-local
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true
  return false
}

interface GeoResult {
  ip: string | null
  location: string | null
  country: string | null
}

// Resolve a location for the sign-in, best-effort. Uses ipapi.co's free no-key
// endpoint over HTTPS with a short timeout; any failure yields nulls so the
// audit row still records device even when geo is unavailable.
//
// When the client IP is loopback/private (local dev, or a request that didn't
// pass through a proxy that sets x-forwarded-for) there's nothing real to
// geolocate, so we fall back to ipapi.co's self-lookup (no IP in the path),
// which resolves THIS machine's public IP + location. We then store that public
// IP instead of the useless "::1". In production behind a proxy the real client
// IP is present, so this fallback doesn't trigger.
async function geolocate(clientIp: string | null): Promise<GeoResult> {
  const useSelfLookup = !clientIp || isPrivateIp(clientIp)
  const url = useSelfLookup
    ? 'https://ipapi.co/json/'
    : `https://ipapi.co/${encodeURIComponent(clientIp)}/json/`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'editorial-tool-audit' },
    })
    if (!res.ok) return { ip: clientIp, location: null, country: null }
    const data = await res.json()
    if (data?.error) return { ip: clientIp, location: null, country: null }

    const parts = [data.city, data.region, data.country_name].filter(Boolean)
    return {
      // On a self-lookup, prefer the resolved public IP over the loopback one.
      ip: useSelfLookup ? (data.ip || clientIp) : clientIp,
      location: parts.length ? parts.join(', ') : null,
      country: data.country_name || null,
    }
  } catch {
    return { ip: clientIp, location: null, country: null }
  } finally {
    clearTimeout(timeout)
  }
}

interface RecordLoginArgs {
  userId: string
  email: string
  fullName: string | null
  role: string | null
  headers: Headers
  method?: LoginMethod | null
}

// Insert one audit row for a successful sign-in. Never throws.
export async function recordLoginAudit({
  userId,
  email,
  fullName,
  role,
  headers,
  method = null,
}: RecordLoginArgs): Promise<void> {
  try {
    const clientIp = getClientIp(headers)
    const userAgent = headers.get('user-agent')
    const geo = await geolocate(clientIp)

    const { error } = await supabaseAdmin.from('login_audit_logs').insert({
      user_id: userId,
      email,
      full_name: fullName,
      user_role: role,
      ip_address: geo.ip,
      location: geo.location,
      country: geo.country,
      user_agent: userAgent,
      login_method: method,
    })
    if (error) console.error('Failed to write login audit log:', error)
  } catch (err) {
    console.error('Unexpected error writing login audit log:', err)
  }
}

// Turn a raw User-Agent string into a short "Browser on OS" label for display.
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device'

  let browser = 'Unknown browser'
  if (/edg/i.test(ua)) browser = 'Edge'
  else if (/opr|opera/i.test(ua)) browser = 'Opera'
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/safari/i.test(ua)) browser = 'Safari'

  let os = ''
  if (/windows/i.test(ua)) os = 'Windows'
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/linux/i.test(ua)) os = 'Linux'

  return os ? `${browser} on ${os}` : browser
}
