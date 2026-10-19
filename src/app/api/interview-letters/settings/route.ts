import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

// PATCH — admin only. Picks the engine for the research step; every
// write-up (letter, email, personalization) stays on Claude regardless.
export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { researchProvider } = await request.json().catch(() => ({}))
  if (researchProvider !== 'gemini' && researchProvider !== 'claude') {
    return NextResponse.json({ error: 'researchProvider must be "gemini" or "claude"' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('interview_letter_settings')
    .upsert({ id: 1, research_provider: researchProvider, updated_by: admin.user.id })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, researchProvider })
}
