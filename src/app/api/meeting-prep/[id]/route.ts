import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isFinalBlockKey } from '@/lib/meeting-prep-document'
import { currentFinalSections, refreshFinalOutput, saveFinalSections, updateMeetingPrep } from '@/lib/meeting-prep-server'
import type { MeetingPrepSession } from '@/types'

interface Params {
  params: { id: string }
}

// GET — poll target for the workspace while a stage is generating in the
// background, and the source of truth on load. RLS (owner or admin) applies
// since this uses the cookie-scoped client, not the service role.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data, error } = await supabase
    .from('meeting_prep_sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

// PATCH — owner or admin, direct manual edits (no AI call). Restricted to the
// fields a user is allowed to hand-edit: research sections, presentation
// points, the planteo text, and one document block at a time ({finalBlock,
// finalBlockText}).
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()

  const { data: session } = await supabaseAdmin
    .from('meeting_prep_sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { researchSections, presentationPoints, planteoOutput, resetStalledStage, finalBlock, finalBlockText } = body

  // Recovery path for a stage that started (stage flipped to an in-progress
  // value) but whose request died without ever reaching completion or the
  // failure handler — e.g. a dev-server restart mid-request. Steps back to
  // the last safe checkpoint so the client can retry without losing anything
  // already approved in an earlier stage.
  if (resetStalledStage) {
    const FALLBACK: Record<string, string> = {
      researching: 'input',
      points_generating: 'awaiting_review',
      planteo_generating: 'points_pending',
      final_generating: 'planteo_pending',
    }
    const fallback = FALLBACK[session.stage]
    if (!fallback) {
      return NextResponse.json({ error: 'This session is not in a stalled state.' }, { status: 409 })
    }
    const { error: resetError } = await supabaseAdmin
      .from('meeting_prep_sessions')
      .update({ stage: fallback, error: null })
      .eq('id', params.id)
    if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 })
    return NextResponse.json({ success: true, stage: fallback })
  }

  // One document block: merged into the current blocks and saved with the
  // recomposed document, so the download always matches the screen.
  if (finalBlock !== undefined) {
    if (!isFinalBlockKey(finalBlock) || typeof finalBlockText !== 'string') {
      return NextResponse.json({ error: 'Invalid document block' }, { status: 400 })
    }
    const sections = { ...currentFinalSections(session), [finalBlock]: finalBlockText.trim() }
    await saveFinalSections(session as MeetingPrepSession, sections)
    return NextResponse.json({ success: true })
  }

  const updates: Record<string, unknown> = {}
  if (researchSections !== undefined) updates.research_sections = researchSections
  if (Array.isArray(presentationPoints)) {
    updates.presentation_points = presentationPoints.filter((p: unknown) => typeof p === 'string').slice(0, 3)
  }
  if (typeof planteoOutput === 'string') updates.planteo_output = planteoOutput

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
  }

  const res = await updateMeetingPrep(params.id, updates)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Failed to save' }, { status: 500 })
  await refreshFinalOutput(params.id)

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

  const { error } = await supabaseAdmin.from('meeting_prep_sessions').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
