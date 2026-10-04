import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isCopywritingPromptKey, isPromptVersionBump, nextPromptVersion } from '@/lib/copywriting'

interface Params {
  params: { key: string }
}

// GET — any authenticated user may read (needed to run the workflow).
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  if (!isCopywritingPromptKey(params.key)) return NextResponse.json({ error: 'Invalid prompt key' }, { status: 400 })

  const { data } = await supabaseAdmin.from('copywriting_prompt').select('prompt_text, prompt_version, updated_at').eq('prompt_key', params.key).maybeSingle()
  return NextResponse.json({ promptText: data?.prompt_text || '', promptVersion: data?.prompt_version || null, updatedAt: data?.updated_at || null })
}

// PATCH — admin only, snapshots the previous version before overwriting
// (Comment: "any change... is saved as a brand-new version rather than
// overwriting what was there before").
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isCopywritingPromptKey(params.key)) return NextResponse.json({ error: 'Invalid prompt key' }, { status: 400 })

  const { promptText, bump } = await request.json().catch(() => ({}))
  if (typeof promptText !== 'string') return NextResponse.json({ error: 'promptText is required' }, { status: 400 })
  if (!isPromptVersionBump(bump)) return NextResponse.json({ error: "bump must be 'major' or 'minor'" }, { status: 400 })

  const { data: current } = await supabaseAdmin
    .from('copywriting_prompt')
    .select('id, prompt_text, prompt_version')
    .eq('prompt_key', params.key)
    .maybeSingle()

  if (!current) {
    const promptVersion = nextPromptVersion([], bump)
    const { error: insertError } = await supabaseAdmin
      .from('copywriting_prompt')
      .insert({ prompt_key: params.key, prompt_text: promptText, prompt_version: promptVersion, updated_by: user.id })
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    return NextResponse.json({ success: true, promptVersion })
  }

  const { data: history } = await supabaseAdmin
    .from('copywriting_prompt_versions')
    .select('prompt_version')
    .eq('prompt_key', params.key)
  const promptVersion = nextPromptVersion(
    [current.prompt_version, ...(history || []).map((h) => h.prompt_version)],
    bump,
  )

  const { error: versionError } = await supabaseAdmin
    .from('copywriting_prompt_versions')
    .insert({ prompt_key: params.key, prompt_text: current.prompt_text, prompt_version: current.prompt_version, saved_by: user.id })
  if (versionError) return NextResponse.json({ error: 'Failed to snapshot version: ' + versionError.message }, { status: 500 })

  const { error } = await supabaseAdmin
    .from('copywriting_prompt')
    .update({ prompt_text: promptText, prompt_version: promptVersion, updated_by: user.id })
    .eq('id', current.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, promptVersion })
}
