import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params {
  params: { company: string; versionId: string }
}

async function requireAdmin() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabaseAdmin
    .from('interview_letter_templates_versions')
    .delete()
    .eq('id', params.versionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// POST — restore a prior version. The version row carries its own company.
// Returns `promptText` (indented JSON of the structure) to match the shared
// PromptVersionHistory component's contract; the template editor JSON.parses
// it back into structure state.
export async function POST(_req: NextRequest, { params }: Params) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: version } = await supabaseAdmin
    .from('interview_letter_templates_versions')
    .select('structure, company')
    .eq('id', params.versionId)
    .single()

  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const { data: current } = await supabaseAdmin
    .from('interview_letter_templates')
    .select('id, structure')
    .eq('company', version.company)
    .single()

  if (!current) return NextResponse.json({ error: 'Current template not found' }, { status: 500 })

  await supabaseAdmin
    .from('interview_letter_templates_versions')
    .insert({ company: version.company, structure: current.structure, saved_by: user.id })

  const { error } = await supabaseAdmin
    .from('interview_letter_templates')
    .update({ structure: version.structure, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, promptText: JSON.stringify(version.structure, null, 2) })
}
