import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { mediaFieldsFromBody } from '@/lib/media-library-fields'
import { PUBLICATION_GUIDES_BUCKET } from '@/lib/copywriting'

interface Params {
  params: { id: string }
}

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

// PATCH — admin only; any subset of the fields. Past work in every module
// keeps the name and details it was created with (each stores its own copy).
export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const fields = mediaFieldsFromBody(await request.json().catch(() => ({})))
  if ('name' in fields && !fields.name) {
    return NextResponse.json({ error: 'Publication name is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('media_library')
    .update({ ...fields, updated_by: admin.user.id })
    .eq('id', params.id)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A publication with this name already exists.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ media: data })
}

// DELETE — admin only. It disappears from every dropdown; existing sessions
// and projects keep their stored name (their links to it are set to NULL).
// Its Copywriting style-guide rows cascade, so their files go first.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { data: guides } = await supabaseAdmin
    .from('copywriting_publication_guides')
    .select('storage_path')
    .eq('publication_id', params.id)
  if (guides?.length) {
    const { error: storageError } = await supabaseAdmin.storage.from(PUBLICATION_GUIDES_BUCKET).remove(guides.map((g) => g.storage_path))
    if (storageError) console.error('Failed to remove publication guide files:', storageError)
  }

  const { error } = await supabaseAdmin.from('media_library').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
