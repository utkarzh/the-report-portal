import { NextRequest, NextResponse } from 'next/server'
import { hasBlockingIssues } from '@/lib/commercial-presentations'
import {
  loadPresentationBundle,
  recordPresentationEvent,
  requirePresentationActor,
  statusChangedResponse,
  touchPresentation,
} from '@/lib/commercial-presentations-server'
import { buildWorkspaceState } from '@/lib/commercial-presentations-state'

interface Params {
  params: { id: string }
}

// POST — "Submit for Approval" (brief §19). Only a complete draft can be
// submitted: every required manual field filled, a Why Now version selected,
// and the media's script present.
export async function POST(_req: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  if (bundle.presentation.status !== 'draft') {
    return NextResponse.json({ error: 'Only a draft can be submitted for approval.' }, { status: 409 })
  }
  if (hasBlockingIssues(bundle.rendered.issues)) {
    return NextResponse.json(
      { error: 'Finish the presentation before submitting it.', issues: bundle.rendered.issues },
      { status: 422 },
    )
  }

  const now = new Date().toISOString()
  const { error, conflict } = await touchPresentation(
    bundle.presentation.id,
    actor.id,
    { status: 'submitted', submitted_by: actor.id, submitted_at: now, review_comment: null },
    'draft',
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (conflict) return statusChangedResponse()
  await recordPresentationEvent(bundle.presentation.id, 'submitted', actor.id)

  const fresh = await loadPresentationBundle(params.id)
  return NextResponse.json(await buildWorkspaceState(fresh!, actor))
}
