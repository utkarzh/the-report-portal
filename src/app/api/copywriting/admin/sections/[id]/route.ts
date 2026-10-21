import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { normalizeSectionName, normalizeSectionDescription, MAX_SECTION_NAME_LENGTH, MAX_SECTION_DESCRIPTION_LENGTH } from '@/lib/copywriting'

interface Params {
  params: { id: string }
}

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return auth
}

// PATCH { name?, description? } — edit. Articles already configured keep the
// name and description they were built with (copywriting_projects.sections
// is a snapshot).
export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const body = await request.json().catch(() => ({}))
  const update: { name?: string; description?: string } = {}
  if (body?.name !== undefined) {
    const name = normalizeSectionName(body.name)
    if (!name) return NextResponse.json({ error: 'Section name is required' }, { status: 400 })
    if (name.length > MAX_SECTION_NAME_LENGTH) {
      return NextResponse.json({ error: `Keep the name under ${MAX_SECTION_NAME_LENGTH} characters.` }, { status: 400 })
    }
    update.name = name
  }
  if (body?.description !== undefined) {
    const description = normalizeSectionDescription(body.description)
    if (description.length > MAX_SECTION_DESCRIPTION_LENGTH) {
      return NextResponse.json({ error: `Keep the description under ${MAX_SECTION_DESCRIPTION_LENGTH} characters.` }, { status: 400 })
    }
    update.description = description
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('copywriting_sections').update(update).eq('id', params.id).select('*').maybeSingle()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A section with this name already exists.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Section not found' }, { status: 404 })
  return NextResponse.json({ section: data })
}

// DELETE — removes it from the library only; articles already configured
// keep it in their structure.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { error } = await supabaseAdmin.from('copywriting_sections').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
