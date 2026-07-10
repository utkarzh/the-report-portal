import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET /api/sessions/[sessionId] — lightweight status + output poll. Used when a
// user returns to a session that is still generating (the original streaming
// request runs server-side and persists on completion, but a returning client
// can't re-attach to that stream — so it polls this until status settles).
export async function GET(_request: NextRequest, { params }: { params: { sessionId: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: row } = await supabaseAdmin
    .from('research_sessions')
    .select('id, user_id, status, initial_output, questions_output, tokens_total, web_searches, cost_usd')
    .eq('id', params.sessionId)
    .single()

  if (!row) return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
  if (row.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    status: row.status,
    initial_output: row.initial_output,
    questions_output: row.questions_output,
    usage: {
      tokens_total: row.tokens_total || 0,
      web_searches: row.web_searches || 0,
      cost_usd: Number(row.cost_usd || 0),
    },
  })
}

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
