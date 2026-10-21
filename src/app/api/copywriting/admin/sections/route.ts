import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { normalizeSectionName, normalizeSectionDescription, MAX_SECTION_NAME_LENGTH, MAX_SECTION_DESCRIPTION_LENGTH } from '@/lib/copywriting'

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return auth
}

// GET — any authenticated user may read (the Configure form's section library).
export async function GET() {
  const auth = await getApiUser()
  if (!auth.user) return auth.response

  const { data, error } = await supabaseAdmin.from('copywriting_sections').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sections: data || [] })
}

// POST { name, description? } — admin only. A section is a name plus what it
// contains; each article sets its own length for it.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const body = await request.json().catch(() => ({}))
  const name = normalizeSectionName(body?.name)
  if (!name) return NextResponse.json({ error: 'Section name is required' }, { status: 400 })
  if (name.length > MAX_SECTION_NAME_LENGTH) {
    return NextResponse.json({ error: `Keep the name under ${MAX_SECTION_NAME_LENGTH} characters.` }, { status: 400 })
  }

  const description = normalizeSectionDescription(body?.description)
  if (description.length > MAX_SECTION_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: `Keep the description under ${MAX_SECTION_DESCRIPTION_LENGTH} characters.` }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('copywriting_sections')
    .insert({ name, description, created_by: admin.user.id })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A section with this name already exists.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ section: data }, { status: 201 })
}
