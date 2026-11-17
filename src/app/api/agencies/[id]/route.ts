import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

interface Params {
  params: { id: string }
}

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return { error: auth.response }
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }
  return { userId: auth.user.id }
}

// PATCH { name?, active? } — the code is deliberately not
// editable: it's what every module has stored. Renaming is safe — work keeps
// the code it was saved with (and presentations their agency_name snapshot).
export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error
  const body = (await request.json().catch(() => ({}))) as { name?: string; active?: boolean }
  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 120)
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    patch.name = name
  }
  if (typeof body.active === 'boolean') patch.active = body.active
  const { data, error } = await supabaseAdmin.from('agencies').update(patch).eq('id', params.id).select('*').single()
  if (error) {
    const duplicate = /duplicate|unique/i.test(error.message)
    return NextResponse.json({ error: duplicate ? 'Another agency already has that name.' : error.message }, { status: duplicate ? 409 : 500 })
  }
  return NextResponse.json({ agency: data })
}

// DELETE — only an agency nothing uses. Anything in use (presentation
// projects, interview letters, their templates/prompts) can only be
// deactivated, so past work always keeps a valid agency.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error
  const { data: agency } = await supabaseAdmin.from('agencies').select('id, code').eq('id', params.id).maybeSingle()
  if (!agency) return NextResponse.json({ error: 'Agency not found' }, { status: 404 })

  const counts = await Promise.all([
    supabaseAdmin.from('projects').select('id', { count: 'exact', head: true }).eq('agency_id', agency.id),
    supabaseAdmin.from('interview_letter_projects').select('id', { count: 'exact', head: true }).eq('company', agency.code),
    supabaseAdmin.from('interview_letter_templates').select('id', { count: 'exact', head: true }).eq('company', agency.code),
  ])
  if (counts.some((c) => (c.count ?? 0) > 0)) {
    return NextResponse.json({ error: 'This agency is used by existing projects, letters or templates. Deactivate it instead.' }, { status: 409 })
  }

  await supabaseAdmin.from('presentation_master_content').delete().eq('kind', 'agency').eq('ref_id', agency.id)
  const { error } = await supabaseAdmin.from('agencies').delete().eq('id', agency.id)
  if (error) {
    // A foreign key from a module table not counted above.
    const inUse = /foreign key|violates/i.test(error.message)
    return NextResponse.json({ error: inUse ? 'This agency is still in use. Deactivate it instead.' : error.message }, { status: inUse ? 409 : 500 })
  }
  return NextResponse.json({ success: true })
}
