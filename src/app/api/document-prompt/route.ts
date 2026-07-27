import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isDocType } from '@/lib/documents'

// Detailed "source of truth" prompt for a document module, keyed by doc_type.
// Mirrors /api/transcript-prompt: any authenticated user may read (needed to
// generate); only admins update, snapshotting the previous version first.

export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const docType = request.nextUrl.searchParams.get('docType')
  if (!isDocType(docType)) {
    return NextResponse.json({ error: 'Invalid docType' }, { status: 400 })
  }

  const { data } = await supabase
    .from('document_prompt')
    .select('prompt_text')
    .eq('doc_type', docType)
    .maybeSingle()

  return NextResponse.json({ promptText: data?.prompt_text || '' })
}

export async function PATCH(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { docType, promptText } = await request.json()
  if (!isDocType(docType)) {
    return NextResponse.json({ error: 'Invalid docType' }, { status: 400 })
  }
  if (typeof promptText !== 'string') {
    return NextResponse.json({ error: 'promptText is required' }, { status: 400 })
  }

  const { data: current } = await supabaseAdmin
    .from('document_prompt')
    .select('id, prompt_text')
    .eq('doc_type', docType)
    .maybeSingle()

  if (!current) {
    // No singleton yet (e.g. brand-new DB seed missing) — create it, no snapshot.
    const { error: insertError } = await supabaseAdmin
      .from('document_prompt')
      .insert({ doc_type: docType, prompt_text: promptText, updated_by: user.id })
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // Snapshot the current text before overwriting.
  const { error: versionError } = await supabaseAdmin
    .from('document_prompt_versions')
    .insert({ doc_type: docType, prompt_text: current.prompt_text, saved_by: user.id })
  if (versionError) {
    return NextResponse.json({ error: 'Failed to snapshot version: ' + versionError.message }, { status: 500 })
  }

  const { error } = await supabaseAdmin
    .from('document_prompt')
    .update({ prompt_text: promptText, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
