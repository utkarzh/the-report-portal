import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// DELETE /api/sessions/[sessionId] — permanently removes an interview
// (research session). Its messages cascade-delete with the row. Admin-only.
export async function DELETE(_request: NextRequest, { params }: { params: { sessionId: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  // Deleting an interview is admin-only.
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: row } = await supabaseAdmin
    .from('research_sessions')
    .select('id')
    .eq('id', params.sessionId)
    .single()

  if (!row) return NextResponse.json({ error: 'Interview not found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('research_sessions')
    .delete()
    .eq('id', row.id)

  if (error) return NextResponse.json({ error: 'Failed to delete interview' }, { status: 500 })

  return NextResponse.json({ success: true })
}
