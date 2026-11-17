import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  editBlockedReason,
  loadPresentationBundle,
  requireAdminActor,
  requirePresentationActor,
  statusChangedResponse,
  touchPresentation,
} from '@/lib/commercial-presentations-server'
import { buildWorkspaceState } from '@/lib/commercial-presentations-state'
import { normalizeVarKey } from '@/lib/commercial-presentations'
import type { PresentationWhyNowInputs } from '@/types'

interface Params {
  params: { id: string }
}

// GET — the full workspace state (see commercial-presentations-state.ts).
export async function GET(_req: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  return NextResponse.json(await buildWorkspaceState(bundle, actor))
}

const MAX_FIELD = 4_000

// PATCH — save the team's inputs: manual fields, the optional Why Now inputs,
// and the project-level anchor event / approved research. No AI call.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  const blocked = editBlockedReason(actor, bundle.presentation)
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })

  const body = (await request.json().catch(() => ({}))) as {
    manualInputs?: Record<string, unknown>
    whyNowInputs?: Record<string, unknown>
    project?: Record<string, unknown>
  }
  const text = (v: unknown, max = MAX_FIELD) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

  const patch: Record<string, unknown> = {}
  if (body.manualInputs && typeof body.manualInputs === 'object') {
    const allowed = new Set(bundle.structure.manualFields.map((f) => f.key))
    const next: Record<string, string> = { ...bundle.presentation.manual_inputs }
    for (const [k, v] of Object.entries(body.manualInputs)) {
      const key = normalizeVarKey(k)
      if (allowed.has(key)) next[key] = text(v)
    }
    patch.manual_inputs = next
  }
  if (body.whyNowInputs && typeof body.whyNowInputs === 'object') {
    const w = body.whyNowInputs
    const next: PresentationWhyNowInputs = { ...bundle.presentation.why_now_inputs }
    if ('relevantDate' in w) next.relevantDate = text(w.relevantDate, 120)
    if ('additionalContext' in w) next.additionalContext = text(w.additionalContext)
    if ('checkRecent' in w) next.checkRecent = w.checkRecent === true
    patch.why_now_inputs = next
  }

  // The presentation write goes first: it is the status guard, so a request
  // that loaded a draft can't change anything once it has been submitted or
  // approved. The project fields are written only after it passed.
  const { error, conflict } = await touchPresentation(bundle.presentation.id, actor.id, patch, bundle.presentation.status)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (conflict) return statusChangedResponse()

  if (body.project && typeof body.project === 'object') {
    const p = body.project
    const projectPatch: Record<string, unknown> = {}
    if ('name' in p && text(p.name, 200)) projectPatch.name = text(p.name, 200)
    if ('anchorEvent' in p) projectPatch.anchor_event = text(p.anchorEvent, 300)
    if ('anchorDate' in p) projectPatch.anchor_date = text(p.anchorDate, 120)
    if ('approvedResearch' in p) projectPatch.approved_research = text(p.approvedResearch, 60_000)
    if (Object.keys(projectPatch).length > 0) {
      const { error: projectError } = await supabaseAdmin
        .from('projects')
        .update({ ...projectPatch, updated_by: actor.id })
        .eq('id', bundle.project.id)
      if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 })
    }
  }

  const fresh = await loadPresentationBundle(params.id)
  return NextResponse.json(await buildWorkspaceState(fresh!, actor))
}

// DELETE — admins only. Removes the presentation and its history; the
// project (and its brief/letter links) is kept for other tools.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied
  const { error } = await supabaseAdmin.from('commercial_presentations').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
