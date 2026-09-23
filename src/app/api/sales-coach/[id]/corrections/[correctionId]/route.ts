import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

export const runtime = 'nodejs'

interface Params {
  params: { id: string; correctionId: string }
}

// DELETE /api/sales-coach/[id]/corrections/[correctionId] — admin only.
// Undoes a mistakenly-submitted correction; does not touch any existing
// Report Card, since a correction only takes effect on the next regenerate.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status')
    .eq('id', auth.user.id)
    .single()
  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabaseAdmin
    .from('sales_coach_corrections')
    .delete()
    .eq('id', params.correctionId)
    .eq('negotiation_id', params.id)
  if (error) return NextResponse.json({ error: 'Could not delete the correction' }, { status: 500 })

  return NextResponse.json({ success: true })
}
