import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { reconcileDocumentStatus } from '@/lib/documents-reconcile'

// GET /api/documents/[id] — poll endpoint used by the output page when a run was
// started elsewhere (can't re-attach the SSE stream).
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: row } = await supabaseAdmin
    .from('document_sessions')
    .select('id, user_id, status, output, updated_at, tokens_total, web_searches, cost_usd')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Heal a run whose final persist was dropped on client disconnect, so a
  // polling reconnect settles (to complete/failed) instead of spinning forever.
  const status = await reconcileDocumentStatus(row)

  return NextResponse.json({
    status,
    output: row.output,
    usage: {
      tokens_total: row.tokens_total,
      web_searches: row.web_searches,
      cost_usd: row.cost_usd,
    },
  })
}

// DELETE /api/documents/[id] — admin-only (mirrors research session delete).
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
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
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: row } = await supabaseAdmin
    .from('document_sessions')
    .select('id')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseAdmin.from('document_sessions').delete().eq('id', row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
