import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isSalesCoachKnowledgeKey } from '@/lib/sales-coach'

interface Params {
  params: { docKey: string }
}

// The knowledge table stores `content`; the API speaks `promptText` so the
// shared PromptVersionHistory component (whose contract is a plain prompt
// string) works unchanged — the mapping happens here at the boundary.

// GET — any authenticated user may read (the coach assembles these at runtime).
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user
  // RLS-scoped read below still needs the caller's own client.
  const supabase = createSupabaseServerClient()

  if (!isSalesCoachKnowledgeKey(params.docKey)) {
    return NextResponse.json({ error: 'Invalid document' }, { status: 400 })
  }

  const { data } = await supabase
    .from('sales_coach_knowledge')
    .select('content')
    .eq('doc_key', params.docKey)
    .maybeSingle()

  return NextResponse.json({ promptText: data?.content || '' })
}

// PATCH — admin only, snapshots the previous version before overwriting (US-046/048).
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isSalesCoachKnowledgeKey(params.docKey)) {
    return NextResponse.json({ error: 'Invalid document' }, { status: 400 })
  }

  const { promptText } = await request.json()
  if (typeof promptText !== 'string') {
    return NextResponse.json({ error: 'promptText is required' }, { status: 400 })
  }

  const { data: current } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .select('id, content')
    .eq('doc_key', params.docKey)
    .maybeSingle()

  if (!current) {
    const { error: insertError } = await supabaseAdmin
      .from('sales_coach_knowledge')
      .insert({ doc_key: params.docKey, content: promptText, updated_by: user.id })
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  const { error: versionError } = await supabaseAdmin
    .from('sales_coach_knowledge_versions')
    .insert({ doc_key: params.docKey, content: current.content, saved_by: user.id })
  if (versionError) {
    return NextResponse.json({ error: 'Failed to snapshot version: ' + versionError.message }, { status: 500 })
  }

  const { error } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .update({ content: promptText, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
