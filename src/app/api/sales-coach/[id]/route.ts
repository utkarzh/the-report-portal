import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { reconcilePendingNegotiations } from '@/lib/assemblyai/reconcile'
import { SALES_COACH_AUDIO_BUCKET } from '@/lib/sales-coach'

export const runtime = 'nodejs'

async function authorise(id: string) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()
  if (!profile || profile.status === 'inactive') {
    return { error: NextResponse.json({ error: 'Account inactive' }, { status: 403 }) }
  }

  const { data: row } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('*')
    .eq('id', id)
    .single()
  if (!row) return { error: NextResponse.json({ error: 'Negotiation not found' }, { status: 404 }) }
  if (row.user_id !== user.id && profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user, profile, row }
}

// GET /api/sales-coach/[id] — the current state of one negotiation. Used by
// the workspace to reconnect to a run in progress (transcribing / analysing)
// after a reload. Heals a transcription that finished while nobody was polling.
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorise(params.id)
  if (auth.error) return auth.error

  let row = auth.row
  if (row.stage === 'transcribing' && row.transcribe_job_id) {
    await reconcilePendingNegotiations({ id: row.id })
    const { data: fresh } = await supabaseAdmin
      .from('sales_coach_negotiations')
      .select('*')
      .eq('id', row.id)
      .single()
    if (fresh) row = fresh
  }
  return NextResponse.json({ negotiation: row })
}

// DELETE /api/sales-coach/[id] — admin only. Removes the audio object, then
// the row (coaching messages cascade).
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorise(params.id)
  if (auth.error) return auth.error
  if (auth.profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (auth.row.audio_path) {
    const { error: storageError } = await supabaseAdmin
      .storage
      .from(SALES_COACH_AUDIO_BUCKET)
      .remove([auth.row.audio_path])
    if (storageError) console.error('Failed to remove sales coach audio:', storageError)
  }

  const { error } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .delete()
    .eq('id', auth.row.id)
  if (error) return NextResponse.json({ error: 'Failed to delete negotiation' }, { status: 500 })

  return NextResponse.json({ success: true })
}
