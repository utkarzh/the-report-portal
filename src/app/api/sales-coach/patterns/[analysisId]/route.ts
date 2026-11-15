import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isSalesCoachAdminEmail } from '@/lib/sales-coach-admins'
import { PATTERN_TABLE } from '@/lib/sales-coach-patterns-server'

// GET /api/sales-coach/patterns/[analysisId] — one saved pattern analysis.
// Sales Coach admins only.
export async function GET(_request: NextRequest, { params }: { params: { analysisId: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  if (!isSalesCoachAdminEmail(auth.user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(params.analysisId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from(PATTERN_TABLE)
    .select('id, subject_user_id, subject_name, scope, card_count, negotiation_ids, period_start, period_end, stats, output, created_by_name, created_at')
    .eq('id', params.analysisId)
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ analysis: data }, { headers: { 'Cache-Control': 'no-store' } })
}
