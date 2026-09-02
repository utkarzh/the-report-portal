import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params {
  params: { id: string }
}

// GET — poll target while a stage is generating in the background, and the
// source of truth on load. Uses the cookie-scoped client so RLS (owner or
// admin) applies.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('interview_letter_projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

// PATCH — owner or admin, direct manual edits (no AI call): confirming/editing
// the why-now hook during hook_review, plus a resetStalledStage recovery path
// for a request that died mid-flight without reaching completion/failure.
export async function PATCH(request: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('id, user_id, stage')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { confirmedHook, hookSource, resetStalledStage } = body

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

  const { error } = await supabaseAdmin.from('interview_letter_projects').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
