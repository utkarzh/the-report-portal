import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

// Country Intelligence is platform-admin only in v1: every run spends money on
// an external API (Gemini) out of a shared account. A per-user access flag can
// follow the usual can_access_* pattern later (and needs the middleware
// select guard described in CLAUDE.md for new profile columns).
export async function requireCiAdmin(): Promise<{ userId: string; response?: undefined } | { userId?: undefined; response: NextResponse }> {
  const auth = await getApiUser()
  if (!auth.user) return { response: auth.response }
  const { data: profile } = await supabaseAdmin.from('profiles').select('role, status').eq('id', auth.user.id).single()
  if (!profile || profile.status !== 'active') return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (profile.role !== 'admin') return { response: NextResponse.json({ error: 'Country Intelligence is available to admins only.' }, { status: 403 }) }
  return { userId: auth.user.id }
}

// Migration 037 not run yet → a clear message instead of a raw PostgREST error.
export function isMissingCiTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /ci_projects|ci_companies|ci_tasks/.test(error.message || '') && /does not exist|could not find/i.test(error.message || ''))
}
export const CI_NOT_INSTALLED = 'Country Intelligence isn’t set up on this database yet — run supabase/migrations/037_country_intelligence.sql.'
