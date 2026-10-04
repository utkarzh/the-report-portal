import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { canAccessCopywritingTool } from '@/lib/access'

// Module-level gate for every per-project Copywriting API route: the caller's
// account must be active and have the Copywriting Tool enabled (admins always
// do). Page access is already enforced by middleware, but API routes are
// excluded from it — without this, a deactivated user or one whose module
// access was revoked could still call research/uploads/exports directly on a
// project they own. Ownership is still checked separately by each route.
// Returns a 403 response to send, or null when access is fine.
export async function denyWithoutCopywritingAccess(userId: string): Promise<NextResponse | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status, can_access_copywriting_tool')
    .eq('id', userId)
    .maybeSingle()
  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (!canAccessCopywritingTool(profile)) {
    return NextResponse.json({ error: 'You no longer have access to the Copywriting Tool' }, { status: 403 })
  }
  return null
}
