import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isInterviewLetterCompany } from '@/lib/interview-letters'

interface Params {
  params: { company: string }
}

// GET — any authenticated user may read (needed to generate letters).
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isInterviewLetterCompany(params.company)) {
    return NextResponse.json({ error: 'Invalid company' }, { status: 400 })
  }

  const { data } = await supabase
    .from('interview_letter_templates')
    .select('structure, updated_at')
    .eq('company', params.company)
    .maybeSingle()

  return NextResponse.json({ structure: data?.structure || [], updatedAt: data?.updated_at || null })
}

// PATCH — admin only, snapshots the previous version before overwriting.
export async function PATCH(request: NextRequest, { params }: Params) {
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

  if (!isInterviewLetterCompany(params.company)) {
    return NextResponse.json({ error: 'Invalid company' }, { status: 400 })
  }

  const { structure } = await request.json()
  if (!Array.isArray(structure)) {
    return NextResponse.json({ error: 'structure (an array) is required' }, { status: 400 })
  }

  const { data: current } = await supabaseAdmin
    .from('interview_letter_templates')
    .select('id, structure')
    .eq('company', params.company)
    .maybeSingle()

  if (!current) {
    const { error: insertError } = await supabaseAdmin
      .from('interview_letter_templates')
      .insert({ company: params.company, structure, updated_by: user.id })
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  const { error: versionError } = await supabaseAdmin
    .from('interview_letter_templates_versions')
    .insert({ company: params.company, structure: current.structure, saved_by: user.id })
  if (versionError) {
    return NextResponse.json({ error: 'Failed to snapshot version: ' + versionError.message }, { status: 500 })
  }

  const { error } = await supabaseAdmin
    .from('interview_letter_templates')
    .update({ structure, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
