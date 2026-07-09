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

function decode(v: string | null): string | null {
  if (!v) return null
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

// ISO country code ("US") → display name ("United States"). Falls back to the
// code itself if the runtime can't resolve it.
function countryName(code: string | null): string | null {
  if (!code) return null
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase())
    return name || code
  } catch {
    return code
  }
}

// Resolve the sign-in location from Vercel's edge geolocation headers. These are
// set by Vercel's network on every incoming request at ZERO latency — no
// external API call, so nothing is added to the login path and it can't be
// rate-limited or blocked (the ipapi.co lookup this replaced was both slow on
// Vercel and blocked from its datacenter IPs, which is why location came back
// "Unknown"). In local dev these headers are absent, so location is simply null.
function resolveGeo(headers: Headers): { location: string | null; country: string | null } {
  const city = decode(headers.get('x-vercel-ip-city'))
  const region = decode(headers.get('x-vercel-ip-country-region'))
  const country = countryName(headers.get('x-vercel-ip-country'))
  const parts = [city, region, country].filter(Boolean)
  return { location: parts.length ? parts.join(', ') : null, country }
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
    const geo = resolveGeo(headers)

    const { error } = await supabaseAdmin.from('login_audit_logs').insert({
      user_id: userId,
      email,
      full_name: fullName,
      user_role: role,
      ip_address: clientIp,
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
