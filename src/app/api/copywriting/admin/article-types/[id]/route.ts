import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { TRC_GUIDES_BUCKET } from '@/lib/copywriting'

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

// PATCH — update name / additional instructions.
export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const body = await request.json().catch(() => ({}))
  const update: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim()
  if (typeof body.additionalInstructions === 'string') update.additional_instructions = body.additionalInstructions

  const { data, error } = await supabaseAdmin.from('copywriting_article_types').update(update).eq('id', params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ articleType: data })
}

// DELETE — removes the article type and its TRC guide/example files from
// storage (guide rows cascade via FK).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { data: guides } = await supabaseAdmin.from('copywriting_trc_guides').select('storage_path').eq('article_type_id', params.id)
  if (guides?.length) {
    await supabaseAdmin.storage.from(TRC_GUIDES_BUCKET).remove(guides.map((g) => g.storage_path))
  }

  const { error } = await supabaseAdmin.from('copywriting_article_types').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
