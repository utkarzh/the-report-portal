import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

// POST /api/sales-coach/privacy-ack — records that the user has seen the
// one-time privacy/data-use notice (US-047). Server-side so it's consistent
// across the user's devices; no consent checkbox on subsequent uploads.
export async function POST() {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  await supabaseAdmin
    .from('profiles')
    .update({ sales_coach_privacy_ack_at: new Date().toISOString() })
    .eq('id', user.id)

  return NextResponse.json({ ok: true })
}
