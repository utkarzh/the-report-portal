import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isInterviewLetterCompany } from '@/lib/interview-letters'

// POST — US-050. Validates project setup, halts with zero API cost if no
// template exists for the selected company (mirrors meeting-prep's
// media-library halt at Step 1). No Claude call in this route — the client
// fires research immediately after creation (US-051: no separate "start"
// action), which does its own token-reserve gate right before its own call.
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, can_access_interview_letter_generator')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_interview_letter_generator) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { company, projectCountry, mediaPartner, mediaPartnerCountry, hookInput } = body

  if (!isInterviewLetterCompany(company)) {
    return NextResponse.json({ error: 'A valid company (TRC or GFDI) is required' }, { status: 400 })
  }
  if (!projectCountry?.trim() || !mediaPartner?.trim()) {
    return NextResponse.json({ error: 'Project country and media partner are required' }, { status: 400 })
  }

  const { data: template } = await supabaseAdmin
    .from('interview_letter_templates')
    .select('id, structure')
    .eq('company', company)
    .maybeSingle()

  if (!template || !Array.isArray(template.structure) || template.structure.length === 0) {
    return NextResponse.json(
      { error: `No letter template is configured for ${company} yet. Ask an admin to set one up before starting a project.` },
      { status: 422 },
    )
  }

  const { data: project, error } = await supabaseAdmin
    .from('interview_letter_projects')
    .insert({
      user_id: user.id,
      company,
      project_country: projectCountry.trim(),
      media_partner: mediaPartner.trim(),
      media_partner_country: (mediaPartnerCountry || '').trim(),
      hook_input: (hookInput || '').trim(),
      stage: 'input',
    })
    .select('id')
    .single()

  if (error || !project) {
    return NextResponse.json({ error: error?.message || 'Failed to create project' }, { status: 500 })
  }

  return NextResponse.json({ id: project.id }, { status: 201 })
}
