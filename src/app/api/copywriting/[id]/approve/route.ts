import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { denyWithoutCopywritingAccess } from '@/lib/copywriting-access'
import type { CopywritingAnalysis } from '@/types'

interface Params {
  params: { id: string }
}

// POST — the various "approve" actions scattered through the flow:
//   { type: 'analysis_section', section } — approve one Analyze section
//   { type: 'plan' }                       — approve the plan (unlocks Draft)
//   { type: 'final' }                      — "Approve Final Version"
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied
  const user = auth.user

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  const { data: project } = await supabaseAdmin.from('copywriting_projects').select('*').eq('id', params.id).single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const type = body.type as string

  if (type === 'analysis_section') {
    const section = body.section as string
    if (!section) return NextResponse.json({ error: 'section is required' }, { status: 400 })
    const analysis = { ...(project.analysis as CopywritingAnalysis) }
    if (!(analysis as Record<string, unknown>)[section]) {
      return NextResponse.json({ error: 'That section does not exist yet' }, { status: 400 })
    }
    ;(analysis as Record<string, { text: string; approved?: boolean }>)[section].approved = true
    await supabaseAdmin.from('copywriting_projects').update({ analysis }).eq('id', project.id)
    return NextResponse.json({ analysis })
  }

  if (type === 'plan') {
    if (project.stage !== 'plan_review') return NextResponse.json({ error: 'Project is not at the plan review step' }, { status: 409 })
    await supabaseAdmin.from('copywriting_projects').update({ plan_status: 'approved' }).eq('id', project.id)
    await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'plan_approved', summary: 'Plan approved — drafting unlocked.' })
    return NextResponse.json({ success: true })
  }

  if (type === 'final') {
    if (!project.draft_text) return NextResponse.json({ error: 'No draft to approve yet' }, { status: 409 })
    const now = new Date().toISOString()
    await supabaseAdmin
      .from('copywriting_projects')
      .update({ final_output: project.draft_text, final_approved_at: now, stage: 'complete' })
      .eq('id', project.id)
    await supabaseAdmin.from('copywriting_project_events').insert({ project_id: project.id, event_type: 'final_approved', summary: 'Final version approved.' })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown approval type' }, { status: 400 })
}
