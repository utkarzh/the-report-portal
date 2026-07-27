import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params {
  params: { versionId: string }
}

async function requireAdmin() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabaseAdmin
    .from('document_prompt_versions')
    .delete()
    .eq('id', params.versionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// POST /api/document-prompt/versions/[versionId] — restore a prior version.
// The version row carries its own doc_type, so restore targets the right
// singleton without a query param.
export async function POST(_req: NextRequest, { params }: Params) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: version } = await supabaseAdmin
    .from('document_prompt_versions')
    .select('prompt_text, doc_type')
    .eq('id', params.versionId)
    .single()

  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const { data: current } = await supabaseAdmin
    .from('document_prompt')
    .select('id, prompt_text')
    .eq('doc_type', version.doc_type)
    .single()

  if (!current) return NextResponse.json({ error: 'Current prompt not found' }, { status: 500 })

  // Snapshot the current prompt before overwriting.
  await supabaseAdmin
    .from('document_prompt_versions')
    .insert({ doc_type: version.doc_type, prompt_text: current.prompt_text, saved_by: user.id })

  const { error } = await supabaseAdmin
    .from('document_prompt')
    .update({ prompt_text: version.prompt_text, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, promptText: version.prompt_text })
}
