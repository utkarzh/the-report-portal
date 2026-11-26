import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isFeedbackStatus } from '@/lib/feedback'

export const runtime = 'nodejs'

interface Params {
  params: { id: string }
}

type AdminResult = { user: User; response?: undefined } | { user: null; response: NextResponse }

async function requireAdmin(): Promise<AdminResult> {
  const auth = await getApiUser()
  if (!auth.user) return { user: null, response: auth.response }
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user: auth.user, response: undefined }
}

// PATCH /api/feedback/[id] — admin-only: move a report to another status
// (Open / In progress / Resolved / Closed). The reporter sees the change
// under "My reports".
export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const body = await request.json().catch(() => ({}))
  const status = (body as Record<string, unknown>).status
  if (!isFeedbackStatus(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  let { data, error } = await supabaseAdmin
    .from('app_feedback')
    .update({ status, status_updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select('id')
  // Before migration 051 there is no status_updated_at column (42703).
  if (error?.code === '42703') {
    ;({ data, error } = await supabaseAdmin.from('app_feedback').update({ status }).eq('id', params.id).select('id'))
  }
  // ...and the old CHECK only allows new/reviewed (23514).
  if (error?.code === '23514') {
    return NextResponse.json(
      { error: 'This status needs the database update in supabase/migrations/051_app_feedback_status.sql. Run it in the Supabase SQL editor, then try again.' },
      { status: 409 },
    )
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

  return NextResponse.json({ success: true })
}

// DELETE /api/feedback/[id] — admin-only cleanup (e.g. spam or stale entries).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { error } = await supabaseAdmin.from('app_feedback').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
