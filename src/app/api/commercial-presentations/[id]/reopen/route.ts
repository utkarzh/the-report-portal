import { NextRequest, NextResponse } from 'next/server'
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

// POST { reason?: 'revision' | 'master_update', comment? } — reopen an
// approved presentation as a draft (brief §19, §22). The approved snapshot
// stays in use (and exportable) until a revised version is approved; drafts
// always render the CURRENT master content, so reopening is also how the team
// "incorporates" New Master Content Available.
export async function POST(request: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  if (bundle.presentation.status !== 'approved') {
    return NextResponse.json({ error: 'Only an approved presentation can be reopened.' }, { status: 409 })
  }
  const body = (await request.json().catch(() => ({}))) as { reason?: string; comment?: string }
  const reason = body.reason === 'master_update' ? 'master_updated' : 'reopened'

  const { error, conflict } = await touchPresentation(bundle.presentation.id, actor.id, { status: 'draft', review_comment: null }, 'approved')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (conflict) return statusChangedResponse()
  await recordPresentationEvent(bundle.presentation.id, reason, actor.id, (body.comment || '').trim().slice(0, 2_000) || null)

  const fresh = await loadPresentationBundle(params.id)
  return NextResponse.json(await buildWorkspaceState(fresh!, actor))
}
