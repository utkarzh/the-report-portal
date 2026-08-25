import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'

// GET /api/finance/notifications — brief G-02, in-app inbox for "what needs
// my attention" (director notified on incidents/rejections, Finance notified
// on submission/resubmission — see the routes that insert these rows).
export async function GET() {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data, error } = await supabaseAdmin
    .from('finance_notifications')
    .select('*')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notifications: data ?? [] })
}
