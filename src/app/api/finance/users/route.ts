import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'

// GET /api/finance/users — the picker for "add this person as Director /
// Sales Rep on a project". Restricted to normal users who already have
// Finance access granted (finance_role IS NOT NULL, via Admin → Edit User) —
// a two-step flow: grant Finance access first, then add them to a project.
// Platform admins are excluded on purpose: they're automatically Finance
// Admins and are never eligible to be a project's Director/Sales Rep.
export async function GET() {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, role, finance_role')
    .eq('status', 'active')
    .eq('role', 'user')
    .not('finance_role', 'is', null)
    .order('full_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data ?? [] })
}
