import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params {
  params: { id: string }
}

// POST — US-057. No AI call: the current email draft becomes the project's
// reusable master. master_email already holds the live draft text (written by
// generate/regenerate), so approval is purely the stage transition.
export async function POST(_request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('id, user_id, stage, master_email')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (project.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (project.stage !== 'email_review') {
    return NextResponse.json({ error: 'This project is not at the email review stage.' }, { status: 409 })
  }
  if (!project.master_email?.trim()) {
    return NextResponse.json({ error: 'There is no email draft to approve yet.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('interview_letter_projects')
    .update({ stage: 'complete' })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
