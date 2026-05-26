import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase.from('general_prompt').select('prompt_text').single()
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

  const body = await request.json()
  const { promptText } = body

  if (typeof promptText !== 'string') {
    return NextResponse.json({ error: 'promptText is required' }, { status: 400 })
  }

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('general_prompt')
    .select('id, prompt_text')
    .single()

  if (fetchError || !current) {
    return NextResponse.json({ error: 'Failed to fetch current prompt' }, { status: 500 })
  }

  const { error: versionError } = await supabaseAdmin
    .from('general_prompt_versions')
    .insert({ prompt_text: current.prompt_text, saved_by: user.id })

  if (versionError) {
    return NextResponse.json({ error: 'Failed to snapshot version: ' + versionError.message }, { status: 500 })
  }

  const { error } = await supabaseAdmin
    .from('general_prompt')
    .update({ prompt_text: promptText, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
