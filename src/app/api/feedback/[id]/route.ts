import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

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

// PATCH /api/feedback/[id] — admin-only triage toggle (new <-> reviewed).
export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const body = await request.json().catch(() => ({}))
  const status = (body as Record<string, unknown>).status
  if (status !== 'new' && status !== 'reviewed') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('app_feedback').update({ status }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
