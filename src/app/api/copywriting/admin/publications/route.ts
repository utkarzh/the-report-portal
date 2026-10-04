import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return auth
}

// GET — any authenticated user may read (needed for the new-project select
// and the workspace's automatic reference lookup). Includes attached guides.
export async function GET() {
  const auth = await getApiUser()
  if (!auth.user) return auth.response

  const { data, error } = await supabaseAdmin
    .from('copywriting_publications')
    .select('*, copywriting_publication_guides(id, filename, char_count, truncated, created_at)')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ publications: data || [] })
}

// POST — admin only.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const body = await request.json().catch(() => ({}))
  const { name, country, additionalRules } = body
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Publication name is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('copywriting_publications')
    .insert({ name: name.trim(), country: country?.trim() || null, additional_rules: additionalRules || '', created_by: admin.user.id })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A publication with this name already exists.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ publication: data }, { status: 201 })
}
