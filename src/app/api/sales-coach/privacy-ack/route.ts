import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// POST /api/sales-coach/privacy-ack — records that the user has seen the
// one-time privacy/data-use notice (US-047). Server-side so it's consistent
// across the user's devices; no consent checkbox on subsequent uploads.
export async function POST() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await supabaseAdmin
    .from('profiles')
    .update({ sales_coach_privacy_ack_at: new Date().toISOString() })
    .eq('id', user.id)

  return NextResponse.json({ ok: true })
}
