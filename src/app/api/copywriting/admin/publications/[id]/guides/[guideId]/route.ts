import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { PUBLICATION_GUIDES_BUCKET } from '@/lib/copywriting'
import { fileViewPayload } from '@/lib/copywriting-storage'

interface Params {
  params: { id: string; guideId: string }
}

// GET — the "View" button: extracted text + a short-lived link to the original.
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: guide } = await supabaseAdmin
    .from('copywriting_publication_guides')
    .select('filename, storage_path, extracted_text, char_count, truncated')
    .eq('id', params.guideId)
    .eq('publication_id', params.id)
    .maybeSingle()
  if (!guide) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await fileViewPayload(PUBLICATION_GUIDES_BUCKET, guide))
}

// DELETE — remove one publication guide file.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: guide } = await supabaseAdmin
    .from('copywriting_publication_guides')
    .select('storage_path')
    .eq('id', params.guideId)
    .eq('publication_id', params.id)
    .maybeSingle()
  if (!guide) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await supabaseAdmin.storage.from(PUBLICATION_GUIDES_BUCKET).remove([guide.storage_path])
  const { error } = await supabaseAdmin.from('copywriting_publication_guides').delete().eq('id', params.guideId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
