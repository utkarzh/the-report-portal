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

// POST { text, baseVersionId? } — save a hand edit as a NEW version (never
// overwrites a generation, so "Return to Previous Version" always works) and
// select it. The flagged external facts carry over from the version edited.
export async function POST(request: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  const blocked = editBlockedReason(actor, bundle.presentation)
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })

  const body = (await request.json().catch(() => ({}))) as { text?: string; baseVersionId?: string }
  const text = (body.text || '').trim().slice(0, 10_000)
  if (!text) return NextResponse.json({ error: 'The Why Now text can’t be empty.' }, { status: 400 })

  let base = bundle.selectedVersion
  if (body.baseVersionId && body.baseVersionId !== base?.id) {
    const { data } = await supabaseAdmin
      .from('presentation_why_now_versions')
      .select('*')
      .eq('id', body.baseVersionId)
      .eq('presentation_id', bundle.presentation.id)
      .maybeSingle()
    base = data ?? base
  }

  const { data: version, error } = await supabaseAdmin
    .from('presentation_why_now_versions')
    .insert({
      presentation_id: bundle.presentation.id,
      kind: 'edit',
      spoken_text: text,
      new_external_facts: base?.new_external_facts ?? [],
      sources: { ...(base?.sources ?? {}), editedFrom: base?.id ?? null },
      research_used: base?.research_used ?? false,
      created_by: actor.id,
    })
    .select('id')
    .single()
  if (error || !version) return NextResponse.json({ error: error?.message || 'Failed to save the edit' }, { status: 500 })

  // The edit is kept in the version history either way; it is only selected
  // while the presentation is still in the status this request loaded.
  const { error: selectError, conflict } = await touchPresentation(
    bundle.presentation.id,
    actor.id,
    { selected_why_now_id: version.id },
    bundle.presentation.status,
  )
  if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 })
  if (conflict) return statusChangedResponse()
  await recordPresentationEvent(bundle.presentation.id, 'why_now_edited', actor.id)

  const fresh = await loadPresentationBundle(params.id)
  return NextResponse.json(await buildWorkspaceState(fresh!, actor))
}
