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

// GET — any authenticated user may read.
export async function GET() {
  const auth = await getApiUser()
  if (!auth.user) return auth.response

  const { data, error } = await supabaseAdmin.from('copywriting_article_types').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ articleTypes: data || [] })
}

// POST — admin only.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const body = await request.json().catch(() => ({}))
  const { name, additionalInstructions } = body
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Article type name is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('copywriting_article_types')
    .insert({ name: name.trim(), additional_instructions: additionalInstructions || '', created_by: admin.user.id })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'An article type with this name already exists.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ articleType: data }, { status: 201 })
}
