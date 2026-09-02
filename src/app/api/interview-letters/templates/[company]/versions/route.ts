import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isInterviewLetterCompany } from '@/lib/interview-letters'

interface Params {
  params: { company: string }
}

async function requireAdmin() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

// GET — lists version history. `PromptVersionHistory` expects a `prompt_text`
// string per version — the structure JSONB is serialized to indented JSON at
// this API boundary so the shared component can render/diff it as plain text
// without needing to know this module stores a structured template.
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!isInterviewLetterCompany(params.company)) {
    return NextResponse.json({ error: 'Invalid company' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('interview_letter_templates_versions')
    .select('id, structure, saved_by, created_at, profiles:saved_by(email)')
    .eq('company', params.company)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const versions = (data || []).map((v: Record<string, unknown>) => ({
    id: v.id,
    prompt_text: JSON.stringify(v.structure, null, 2),
    saved_by: v.saved_by,
    saved_by_email: (v.profiles as { email?: string } | null)?.email ?? null,
    created_at: v.created_at,
  }))

  return NextResponse.json({ versions })
}
