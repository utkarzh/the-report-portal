import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { canAccessFinance, isFinanceAdmin } from '@/lib/access'

// API routes use the service-role client for reads/writes (RLS is the
// storage/browser-write backstop, not the enforcement point here), so access
// control has to be checked explicitly in code — mirrors every other module's
// API route pattern (see /api/meeting-prep).
async function getCallerProfile() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, full_name, email, finance_role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') return null
  return profile
}

export async function requireFinanceAccess() {
  const profile = await getCallerProfile()
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  if (!canAccessFinance(profile)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  return { profile } as const
}

export async function requireFinanceAdmin() {
  const profile = await getCallerProfile()
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  if (!isFinanceAdmin(profile)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  return { profile } as const
}

// Belt-and-suspenders only: the Director/Sales Rep picker (GET .../users)
// already requires finance_role to be set before someone is even
// selectable, so this should be a no-op in normal use. Kept in case a
// project member is ever added outside that picker. Only lifts a NULL to
// 'field'; never touches an account that already has a value (e.g. never
// downgrades an existing 'finance_admin'), and platform admins don't need
// it at all (they already bypass via role === 'admin').
export async function grantFieldAccessIfNeeded(userId: string) {
  await supabaseAdmin
    .from('profiles')
    .update({ finance_role: 'field' })
    .eq('id', userId)
    .eq('role', 'user')
    .is('finance_role', null)
}
