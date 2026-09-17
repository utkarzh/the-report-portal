import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

interface Params {
  params: { company: string; versionId: string }
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

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response
  const user = admin.user

  const { error } = await supabaseAdmin
    .from('interview_letter_research_prompts_versions')
    .delete()
    .eq('id', params.versionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// POST — restore a prior version. The version row carries its own company.
export async function POST(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response
  const user = admin.user

  const { data: version } = await supabaseAdmin
    .from('interview_letter_research_prompts_versions')
    .select('prompt_text, company')
    .eq('id', params.versionId)
    .single()

  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const { data: current } = await supabaseAdmin
    .from('interview_letter_research_prompts')
    .select('id, prompt_text')
    .eq('company', version.company)
    .single()

  if (!current) return NextResponse.json({ error: 'Current prompt not found' }, { status: 500 })

  await supabaseAdmin
    .from('interview_letter_research_prompts_versions')
    .insert({ company: version.company, prompt_text: current.prompt_text, saved_by: user.id })

  const { error } = await supabaseAdmin
    .from('interview_letter_research_prompts')
    .update({ prompt_text: version.prompt_text, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, promptText: version.prompt_text })
}
