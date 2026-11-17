import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
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

// POST { action: 'approve' | 'return', comment? } — Manager/Admin review
// (brief §19). "Edit and Approve" is: edit while submitted (only approvers
// can), then approve — the snapshot records that it was edited on approval.
// A Manager/Admin may approve a presentation they created or edited
// themselves: this is quality control, not segregation of duties.
export async function POST(request: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  if (!actor.canApprove) return NextResponse.json({ error: 'Only a Manager or Admin can review presentations.' }, { status: 403 })

  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  const { presentation } = bundle
  if (presentation.status !== 'submitted') {
    return NextResponse.json({ error: 'This presentation is not awaiting approval.' }, { status: 409 })
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string; comment?: string }
  const comment = (body.comment || '').trim().slice(0, 4_000)

  if (body.action === 'return') {
    if (!comment) return NextResponse.json({ error: 'Say what needs to change so the team can fix it.' }, { status: 400 })
    const { error, conflict } = await touchPresentation(presentation.id, actor.id, { status: 'draft', review_comment: comment }, 'submitted')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (conflict) return statusChangedResponse()
    await recordPresentationEvent(presentation.id, 'returned', actor.id, comment)
  } else if (body.action === 'approve') {
    if (hasBlockingIssues(bundle.rendered.issues)) {
      return NextResponse.json({ error: 'The presentation is incomplete and can’t be approved yet.', issues: bundle.rendered.issues }, { status: 422 })
    }
    // Read before the claim below overwrites updated_by.
    const editedOnApproval = Boolean(
      presentation.submitted_at &&
        presentation.updated_by &&
        presentation.updated_by !== presentation.submitted_by &&
        new Date(presentation.updated_at) > new Date(presentation.submitted_at),
    )

    // 1. Claim: submitted → approved in one guarded update. Only one of two
    //    Managers approving at once gets here, and from this moment every
    //    edit route refuses (its own guard expects draft/submitted).
    const claim = await touchPresentation(presentation.id, actor.id, { status: 'approved', review_comment: comment || null }, 'submitted')
    if (claim.error) return NextResponse.json({ error: claim.error.message }, { status: 500 })
    if (claim.conflict) return statusChangedResponse()

    // Undo the claim if the snapshot can't be written, so the presentation
    // goes back to awaiting approval instead of "approved" with no snapshot.
    // Restores the previous last editor too, so a later approval doesn't
    // record "edited on approval" for an edit that never happened.
    const releaseClaim = () =>
      touchPresentation(
        presentation.id,
        presentation.updated_by || actor.id,
        { status: 'submitted', review_comment: presentation.review_comment },
        'approved',
      )

    // 2. Snapshot what is now locked: re-read after the claim, so an edit
    //    saved just before it is included.
    const locked = await loadPresentationBundle(presentation.id)
    if (!locked || hasBlockingIssues(locked.rendered.issues)) {
      await releaseClaim()
      return NextResponse.json(
        { error: 'The presentation is incomplete and can’t be approved yet.', issues: locked?.rendered.issues ?? [] },
        { status: 422 },
      )
    }
    const { data: last } = await supabaseAdmin
      .from('presentation_snapshots')
      .select('version_number')
      .eq('presentation_id', presentation.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    // The exact presentation as approved: rendered blocks + which master
    // content versions produced them. Never updated afterwards.
    const lp = locked.project
    const { data: snapshot, error: snapError } = await supabaseAdmin
      .from('presentation_snapshots')
      .insert({
        presentation_id: presentation.id,
        version_number: (last?.version_number ?? 0) + 1,
        blocks: locked.rendered.blocks,
        master_refs: locked.masterRefs,
        manual_inputs: locked.presentation.manual_inputs,
        project_snapshot: {
          name: lp.name,
          agency: lp.agency_name,
          country: lp.country,
          media: lp.media_name,
          mediaMarket: locked.mediaMarket,
          edition: lp.edition,
          anchorEvent: lp.anchor_event,
          anchorDate: lp.anchor_date,
          language: locked.presentation.language,
        },
        why_now_version_id: locked.selectedVersion?.id ?? null,
        why_now_text: locked.selectedVersion?.spoken_text ?? null,
        new_external_facts: locked.selectedVersion?.new_external_facts ?? [],
        approved_by: actor.id,
        edited_on_approval: editedOnApproval,
      })
      .select('id')
      .single()
    if (snapError || !snapshot) {
      await releaseClaim()
      return NextResponse.json({ error: snapError?.message || 'Failed to save the approved version' }, { status: 500 })
    }

    // 3. Point the presentation at its new snapshot.
    const { error, conflict } = await touchPresentation(presentation.id, actor.id, { approved_snapshot_id: snapshot.id }, 'approved')
    if (error || conflict) {
      await supabaseAdmin.from('presentation_snapshots').delete().eq('id', snapshot.id)
      await releaseClaim()
      return error ? NextResponse.json({ error: error.message }, { status: 500 }) : statusChangedResponse()
    }
    await recordPresentationEvent(presentation.id, 'approved', actor.id, comment || (editedOnApproval ? 'Edited on approval' : null))
  } else {
    return NextResponse.json({ error: "action must be 'approve' or 'return'" }, { status: 400 })
  }

  const fresh = await loadPresentationBundle(params.id)
  return NextResponse.json(await buildWorkspaceState(fresh!, actor))
}
