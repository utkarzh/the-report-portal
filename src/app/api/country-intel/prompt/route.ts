import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireCiAdmin } from '@/lib/country-intel/auth'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/country-intel/prompts'

// GET   /api/country-intel/prompt — the current system prompt + its version history
// PATCH /api/country-intel/prompt — { prompt_text } — snapshots the previous text, then saves
export async function GET() {
  const auth = await requireCiAdmin()
  if (!auth.userId) return auth.response
  const [{ data: cur }, { data: versions }] = await Promise.all([
    supabaseAdmin.from('ci_system_prompt').select('prompt_text, updated_at').eq('id', 1).maybeSingle(),
    supabaseAdmin.from('ci_system_prompt_versions').select('id, prompt_text, created_at').order('created_at', { ascending: false }).limit(30),
  ])
  return NextResponse.json({ prompt_text: cur?.prompt_text || DEFAULT_SYSTEM_PROMPT, is_default: !cur, updated_at: cur?.updated_at || null, versions: versions || [] })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireCiAdmin()
  if (!auth.userId) return auth.response
  const body = await request.json().catch(() => ({}))
  const text = String(body.prompt_text || '').trim()
  if (text.length < 200) return NextResponse.json({ error: 'The system prompt looks too short to be complete.' }, { status: 400 })
  const { data: cur } = await supabaseAdmin.from('ci_system_prompt').select('prompt_text').eq('id', 1).maybeSingle()
  // Snapshot what is being replaced (the built-in default counts as a version on the first save).
  await supabaseAdmin.from('ci_system_prompt_versions').insert({ prompt_text: cur?.prompt_text || DEFAULT_SYSTEM_PROMPT, saved_by: auth.userId })
  const { error } = await supabaseAdmin.from('ci_system_prompt').upsert({ id: 1, prompt_text: text, updated_by: auth.userId, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
