import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isSalesCoachAdminDocKey } from '@/lib/sales-coach'
import { isSalesCoachAdminEmail } from '@/lib/sales-coach-admins'

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

  if (!isSalesCoachAdminDocKey(params.docKey)) {
    return NextResponse.json({ error: 'Invalid document' }, { status: 400 })
  }

  const { data } = await supabase
    .from('sales_coach_knowledge')
    .select('content')
    .eq('doc_key', params.docKey)
    .maybeSingle()

  return NextResponse.json({ promptText: data?.content || '' })
}

// PATCH — Sales Coach admins only (email allowlist, see sales-coach-admins.ts),
// snapshots the previous version before overwriting (US-046/048).
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  if (!isSalesCoachAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isSalesCoachAdminDocKey(params.docKey)) {
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
    if (insertError) return NextResponse.json({ error: saveErrorMessage(insertError, params.docKey) }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  const { error: versionError } = await supabaseAdmin
    .from('sales_coach_knowledge_versions')
    .insert({ doc_key: params.docKey, content: current.content, saved_by: user.id })
  if (versionError) {
    return NextResponse.json({ error: 'Failed to snapshot version: ' + saveErrorMessage(versionError, params.docKey) }, { status: 500 })
  }

  const { error } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .update({ content: promptText, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

// The doc_key CHECK constraints only allow 'live_coach' once migration 045 has
// run; say so instead of showing Postgres's constraint name.
function saveErrorMessage(error: { code?: string; message: string }, docKey?: string): string {
  if (error.code === '23514' && error.message.includes('doc_key') && docKey === 'followup_decision') {
    return 'This document can be saved once the database update for it (migration 049_sales_coach_followup_decision.sql) has been run. Until then the Report Card uses the built-in 14 November 2026 Decision Support prompt.'
  }
  if (error.code === '23514' && error.message.includes('doc_key')) {
    return 'This document can be saved once the database update for it (migration 045_sales_coach_live_coach_and_patterns.sql) has been run. Until then the Live Coach uses its built-in instructions.'
  }
  return error.message
}
