import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/auth/api-user'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isSalesCoachAdminEmail } from '@/lib/sales-coach-admins'

interface Params {
  params: { docKey: string; versionId: string }
}

// Resolves the caller and requires the Sales Coach admin email allowlist (not
// the admin role — see sales-coach-admins.ts). A transient sign-in-service
// failure comes back as a retryable 503 (see getApiUser), never as Forbidden.
async function requireAdmin(): Promise<{ user: User; response?: undefined } | { user: null; response: NextResponse }> {
  const auth = await getApiUser()
  if (!auth.user) return auth
  if (!isSalesCoachAdminEmail(auth.user.email)) return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user: auth.user }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.user) return auth.response
  const user = auth.user

  const { error } = await supabaseAdmin
    .from('sales_coach_knowledge_versions')
    .delete()
    .eq('id', params.versionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// POST — restore a prior version. The version row carries its own doc_key.
// Snapshots the current content first, so a rollback is itself reversible.
export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: version } = await supabaseAdmin
    .from('sales_coach_knowledge_versions')
    .select('content, doc_key')
    .eq('id', params.versionId)
    .single()

  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const { data: current } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .select('id, content')
    .eq('doc_key', version.doc_key)
    .single()

  if (!current) return NextResponse.json({ error: 'Current document not found' }, { status: 500 })

  await supabaseAdmin
    .from('sales_coach_knowledge_versions')
    .insert({ doc_key: version.doc_key, content: current.content, saved_by: user.id })

  const { error } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .update({ content: version.content, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, promptText: version.content })
}
