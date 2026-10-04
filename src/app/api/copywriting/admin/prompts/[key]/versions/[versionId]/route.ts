import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { nextPromptVersion } from '@/lib/copywriting'

interface Params {
  params: { key: string; versionId: string }
}

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return auth
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { error } = await supabaseAdmin.from('copywriting_prompt_versions').delete().eq('id', params.versionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// POST — roll back to a prior version ("If a change causes problems once
// live, the admin can roll back to any earlier version at any time; nothing
// is ever permanently lost" — the current text is itself snapshotted first).
// The restored text goes live as a NEW minor version (e.g. restoring 0.1
// while 1.2 is live makes it 1.3), so no two entries ever share a label.
export async function POST(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response
  const user = admin.user

  const { data: version } = await supabaseAdmin
    .from('copywriting_prompt_versions')
    .select('prompt_text, prompt_key')
    .eq('id', params.versionId)
    .single()
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const { data: current } = await supabaseAdmin
    .from('copywriting_prompt')
    .select('id, prompt_text, prompt_version')
    .eq('prompt_key', version.prompt_key)
    .single()
  if (!current) return NextResponse.json({ error: 'Current prompt not found' }, { status: 500 })

  const { data: history } = await supabaseAdmin
    .from('copywriting_prompt_versions')
    .select('prompt_version')
    .eq('prompt_key', version.prompt_key)
  const promptVersion = nextPromptVersion(
    [current.prompt_version, ...(history || []).map((h) => h.prompt_version)],
    'minor',
  )

  const { error: snapshotError } = await supabaseAdmin
    .from('copywriting_prompt_versions')
    .insert({ prompt_key: version.prompt_key, prompt_text: current.prompt_text, prompt_version: current.prompt_version, saved_by: user.id })
  if (snapshotError) return NextResponse.json({ error: 'Failed to snapshot version: ' + snapshotError.message }, { status: 500 })

  const { error } = await supabaseAdmin
    .from('copywriting_prompt')
    .update({ prompt_text: version.prompt_text, prompt_version: promptVersion, updated_by: user.id })
    .eq('id', current.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, promptText: version.prompt_text, promptVersion })
}
