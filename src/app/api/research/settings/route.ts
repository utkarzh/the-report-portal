import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isMissingTable } from '@/lib/knowledge/schema-compat'

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role, status').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin' || profile.status === 'inactive') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

// PATCH — admin only. Picks who does the Interview Tool's web research;
// Claude writes the research and the questions either way.
export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { researchProvider } = await request.json().catch(() => ({}))
  if (researchProvider !== 'claude' && researchProvider !== 'gemini') {
    return NextResponse.json({ error: 'researchProvider must be "claude" or "gemini"' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('research_settings')
    .upsert({ id: 1, research_provider: researchProvider, updated_by: admin.user.id })

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: 'This setting needs supabase/migrations/040_research_engine.sql to be run first.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, researchProvider })
}
