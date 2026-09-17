import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isInterviewType } from '@/lib/meeting-prep'

interface Params {
  params: { variant: string }
}

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

export async function GET(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  if (!isInterviewType(params.variant)) {
    return NextResponse.json({ error: 'Invalid variant' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('meeting_prep_planteo_library_versions')
    .select('id, template_text, saved_by, created_at, profiles:saved_by(email)')
    .eq('variant', params.variant)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aliased to prompt_text so PromptVersionHistory's generic contract applies.
  const versions = (data || []).map((v: Record<string, unknown>) => ({
    id: v.id,
    prompt_text: v.template_text,
    saved_by: v.saved_by,
    saved_by_email: (v.profiles as { email?: string } | null)?.email ?? null,
    created_at: v.created_at,
  }))

  return NextResponse.json({ versions })
}
