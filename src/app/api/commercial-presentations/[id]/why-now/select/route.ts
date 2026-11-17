import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  editBlockedReason,
  statusChangedResponse,
  touchPresentation,
  loadPresentationBundle,
  recordPresentationEvent,
  requirePresentationActor,
} from '@/lib/commercial-presentations-server'
import { buildWorkspaceState } from '@/lib/commercial-presentations-state'

interface Params {
  params: { id: string }
}

// POST { versionId } — "Select Preferred Version" / "Return to Previous
// Version": point the presentation at an existing version. No AI call.
export async function POST(request: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  const blocked = editBlockedReason(actor, bundle.presentation)
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })

  const { versionId } = (await request.json().catch(() => ({}))) as { versionId?: string }
  const { data: version } = await supabaseAdmin
    .from('presentation_why_now_versions')
    .select('id')
    .eq('id', versionId || '')
    .eq('presentation_id', bundle.presentation.id)
    .maybeSingle()
  if (!version) return NextResponse.json({ error: 'That version doesn’t belong to this presentation.' }, { status: 404 })

  const { error, conflict } = await touchPresentation(bundle.presentation.id, actor.id, { selected_why_now_id: version.id }, bundle.presentation.status)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (conflict) return statusChangedResponse()
  await recordPresentationEvent(bundle.presentation.id, 'why_now_selected', actor.id)

  const fresh = await loadPresentationBundle(params.id)
  return NextResponse.json(await buildWorkspaceState(fresh!, actor))
}
