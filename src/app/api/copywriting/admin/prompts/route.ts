import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { COPYWRITING_PROMPT_KEYS } from '@/lib/copywriting'

// GET — every stage prompt (admin landing list — Stage Prompts card).
export async function GET() {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabaseAdmin.from('copywriting_prompt').select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byKey = new Map((data || []).map((p) => [p.prompt_key, p]))
  const prompts = COPYWRITING_PROMPT_KEYS.map(({ key, label, description }) => ({
    key,
    label,
    description,
    promptText: byKey.get(key)?.prompt_text || '',
    updatedAt: byKey.get(key)?.updated_at || null,
  }))

  return NextResponse.json({ prompts })
}
