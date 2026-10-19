import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'

interface Params {
  params: { id: string }
}

// GET — poll target while a stage is generating in the background, and the
// source of truth on load. Uses the cookie-scoped client so RLS (owner or
// admin) applies.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const auth = await getApiUser()
  if (!auth.user) return auth.response

  const { data, error } = await supabase
    .from('interview_letter_projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The brief snapshot (~100k characters) is only ever used server-side.
  return NextResponse.json({ ...data, editorial_brief_snapshot: null })
}

// Stepping back to an earlier step (client request, 19 Oct 2026: "jump on
// various steps"). Nothing is deleted: the step's content stays as it was and
// the later steps' content is kept too, so the user can "keep the current
// letter / email" instead of regenerating it.
const REOPEN: Record<string, { to: string; from: string[]; ready: (p: Record<string, unknown>) => boolean }> = {
  // Edit the hook, then redraft the letter (or keep the current one).
  hook: {
    to: 'hook_review',
    from: ['letter_review', 'letter_approved', 'email_review', 'complete'],
    ready: (p) => Array.isArray(p.research) && p.research.length > 0,
  },
  // Back to the paragraphs; approved ones can be unlocked one by one.
  letter: {
    to: 'letter_review',
    from: ['hook_review', 'letter_approved', 'email_review', 'complete'],
    ready: (p) => Array.isArray(p.paragraphs) && p.paragraphs.length > 0,
  },
  // Review / regenerate the email again.
  email: {
    to: 'email_review',
    from: ['letter_approved', 'complete'],
    ready: (p) => typeof p.master_email === 'string' && p.master_email.trim().length > 0,
  },
}

// PATCH — owner or admin, direct manual edits (no AI call): confirming/editing
// the why-now hook during hook_review, `reopen` to step back to an earlier
// step, plus a resetStalledStage recovery path for a request that died
// mid-flight without reaching completion/failure.
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('id, user_id, stage, research, paragraphs, master_email')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { confirmedHook, hookSource, resetStalledStage, reopen } = body

  if (reopen !== undefined) {
    const rule = REOPEN[reopen as string]
    if (!rule) return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
    if (!rule.from.includes(project.stage) || !rule.ready(project)) {
      return NextResponse.json({ error: 'That step can’t be reopened from here.' }, { status: 409 })
    }
    const { error: reopenError } = await supabaseAdmin
      .from('interview_letter_projects')
      .update({ stage: rule.to, error: null })
      .eq('id', params.id)
      .eq('stage', project.stage)
    if (reopenError) return NextResponse.json({ error: reopenError.message }, { status: 500 })
    return NextResponse.json({ success: true, stage: rule.to })
  }

  if (resetStalledStage) {
    // Only the streaming research call persists an in-progress stage before
    // completing — every other AI call in this module is a single awaited
    // request that either finishes or never updates the stage at all, so
    // there's nothing else that can get stuck mid-flight.
    const FALLBACK: Record<string, string> = {
      researching: 'input',
    }
    const fallback = FALLBACK[project.stage]
    if (!fallback) {
      return NextResponse.json({ error: 'This project is not in a stalled state.' }, { status: 409 })
    }
    const { error: resetError } = await supabaseAdmin
      .from('interview_letter_projects')
      .update({ stage: fallback, error: null })
      .eq('id', params.id)
    if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 })
    return NextResponse.json({ success: true, stage: fallback })
  }

  const updates: Record<string, unknown> = {}
  if (confirmedHook !== undefined) updates.confirmed_hook = confirmedHook
  if (hookSource !== undefined) updates.hook_source = hookSource

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('interview_letter_projects').update(updates).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

// DELETE — admin only.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabaseAdmin.from('interview_letter_projects').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
