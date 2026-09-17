import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { canAccessMeetingPreparation } from '@/lib/access'

export const runtime = 'nodejs'

// DELETE /api/meeting-prep/advertiser-tracker/[country] — remove a country's tracker.
export async function DELETE(_request: NextRequest, { params }: { params: { country: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status, can_access_meeting_preparation')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (!canAccessMeetingPreparation(profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const country = decodeURIComponent(params.country)
  const { error } = await supabaseAdmin
    .from('meeting_prep_advertiser_tracker')
    .delete()
    .ilike('country', country)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath('/admin/meeting-prep/advertiser-tracker')
  return NextResponse.json({ ok: true })
}
