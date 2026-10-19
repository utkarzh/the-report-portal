import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { mediaFieldsFromBody } from '@/lib/media-library-fields'

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

// POST — admin only. Adds a publication to the central Media Library (every
// module's media-partner dropdown). Module-specific details are optional.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const body = await request.json().catch(() => ({}))
  const fields = mediaFieldsFromBody(body)
  if (!fields.name) {
    return NextResponse.json({ error: 'Publication name is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('media_library')
    .insert({ ...fields, created_by: admin.user.id, updated_by: admin.user.id })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A publication with this name already exists.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ media: data }, { status: 201 })
}
