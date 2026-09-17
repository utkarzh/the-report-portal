import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

interface Params {
  params: { categoryId: string; versionId: string }
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

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { error } = await supabaseAdmin
    .from('category_prompt_versions')
    .delete()
    .eq('id', params.versionId)
    .eq('category_id', params.categoryId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// POST /api/categories/[categoryId]/versions/[versionId] — restore a prior version
export async function POST(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response
  const user = admin.user

  const { data: version } = await supabaseAdmin
    .from('category_prompt_versions')
    .select('prompt_text')
    .eq('id', params.versionId)
    .eq('category_id', params.categoryId)
    .single()

  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const { data: current } = await supabaseAdmin
    .from('categories')
    .select('prompt_text')
    .eq('id', params.categoryId)
    .single()

  if (!current) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  // Snapshot current before overwriting
  await supabaseAdmin
    .from('category_prompt_versions')
    .insert({ category_id: params.categoryId, prompt_text: current.prompt_text, saved_by: user.id })

  const { error } = await supabaseAdmin
    .from('categories')
    .update({ prompt_text: version.prompt_text })
    .eq('id', params.categoryId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, promptText: version.prompt_text })
}
