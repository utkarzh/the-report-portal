import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMeetingPrepPromptKey } from '@/lib/meeting-prep'

interface Params {
  params: { promptKey: string }
}

// GET — any authenticated user may read (needed to generate).
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isMeetingPrepPromptKey(params.promptKey)) {
    return NextResponse.json({ error: 'Invalid promptKey' }, { status: 400 })
  }

  const { data } = await supabase
    .from('meeting_prep_prompt')
    .select('prompt_text')
    .eq('prompt_key', params.promptKey)
    .maybeSingle()

  return NextResponse.json({ promptText: data?.prompt_text || '' })
}

// PATCH — admin only, snapshots the previous version before overwriting.
export async function PATCH(request: NextRequest, { params }: Params) {
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

  if (!isMeetingPrepPromptKey(params.promptKey)) {
    return NextResponse.json({ error: 'Invalid promptKey' }, { status: 400 })
  }

  const { promptText } = await request.json()
  if (typeof promptText !== 'string') {
    return NextResponse.json({ error: 'promptText is required' }, { status: 400 })
  }

  const { data: current } = await supabaseAdmin
    .from('meeting_prep_prompt')
    .select('id, prompt_text')
    .eq('prompt_key', params.promptKey)
    .maybeSingle()

  if (!current) {
    const { error: insertError } = await supabaseAdmin
      .from('meeting_prep_prompt')
      .insert({ prompt_key: params.promptKey, prompt_text: promptText, updated_by: user.id })
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  const { error: versionError } = await supabaseAdmin
    .from('meeting_prep_prompt_versions')
    .insert({ prompt_key: params.promptKey, prompt_text: current.prompt_text, saved_by: user.id })
  if (versionError) {
    return NextResponse.json({ error: 'Failed to snapshot version: ' + versionError.message }, { status: 500 })
  }

  const { error } = await supabaseAdmin
    .from('meeting_prep_prompt')
    .update({ prompt_text: promptText, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
