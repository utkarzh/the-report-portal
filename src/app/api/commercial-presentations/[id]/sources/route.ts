import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { briefMatchScore, matchBriefs } from '@/lib/interview-letters'
import { normalizeMediaName } from '@/lib/media-library'
import {
  editBlockedReason,
  statusChangedResponse,
  touchPresentation,
  loadPresentationBundle,
  profileNames,
  recordPresentationEvent,
  requirePresentationActor,
} from '@/lib/commercial-presentations-server'
import { buildWorkspaceState } from '@/lib/commercial-presentations-state'
import type { InterviewLetterBriefOption } from '@/types'

interface Params {
  params: { id: string }
}

// GET — candidates for the project's Editorial Brief and Interview Request
// Letter (the "fetch" half of fetch-or-generate). Briefs come from the
// existing Editorial Briefs module, letters from Interview Letters; any team
// member's may be used, as in those modules. Best matches first: same
// country, then same media, then newest.
export async function GET(_req: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  const { project } = bundle
  const sameMedia = (m: string | null) => normalizeMediaName(m) === normalizeMediaName(project.media_name)

  const [{ data: briefRows }, { data: letterRows }] = await Promise.all([
    supabaseAdmin
      .from('document_sessions')
      .select('id, title, project_country, media_partner, status, user_id, created_at')
      .eq('doc_type', 'editorial_brief')
      .in('status', ['complete', 'generating'])
      .order('created_at', { ascending: false })
      .limit(300),
    supabaseAdmin
      .from('interview_letter_projects')
      .select('id, company, project_country, media_partner, stage, master_letter, user_id, created_at')
      .not('stage', 'in', '("input","researching","failed")')
      .order('created_at', { ascending: false })
      .limit(300),
  ])

  const briefs = matchBriefs((briefRows || []) as (InterviewLetterBriefOption & { status: string; user_id: string | null })[], project.country)
    .sort((a, b) => Number(sameMedia(b.media_partner)) - Number(sameMedia(a.media_partner)))
    .slice(0, 30)
  const letters = (letterRows || [])
    .filter((l) => briefMatchScore({ project_country: l.project_country, title: '' }, project.country) > 0)
    .sort((a, b) => Number(sameMedia(b.media_partner)) - Number(sameMedia(a.media_partner)))
    .slice(0, 30)

  const names = await profileNames([...briefs.map((b) => b.user_id), ...letters.map((l) => l.user_id)])
  return NextResponse.json({
    briefs: briefs.map((b) => ({
      id: b.id,
      title: b.title,
      country: b.project_country,
      media: b.media_partner,
      status: b.status,
      createdAt: b.created_at,
      createdBy: b.user_id ? names.get(b.user_id) || null : null,
      sameMedia: sameMedia(b.media_partner),
    })),
    letters: letters.map((l) => ({
      id: l.id,
      title: `${l.company} — ${l.media_partner}`,
      country: l.project_country,
      media: l.media_partner,
      status: l.master_letter ? 'approved' : l.stage,
      createdAt: l.created_at,
      createdBy: l.user_id ? names.get(l.user_id) || null : null,
      sameMedia: sameMedia(l.media_partner),
    })),
  })
}

// POST { kind: 'brief' | 'letter', id: string | null, source?: 'attached' | 'generated' }
// — set (or clear, with id null) the brief/letter "in use" for the project.
export async function POST(request: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  const blocked = editBlockedReason(actor, bundle.presentation)
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })

  const body = (await request.json().catch(() => ({}))) as { kind?: string; id?: string | null; source?: string }
  if (body.kind !== 'brief' && body.kind !== 'letter') {
    return NextResponse.json({ error: 'kind must be brief or letter' }, { status: 400 })
  }
  const id = typeof body.id === 'string' && body.id ? body.id : null
  const source = body.source === 'generated' ? 'generated' : 'attached'

  if (id) {
    const { data } =
      body.kind === 'brief'
        ? await supabaseAdmin.from('document_sessions').select('id, doc_type').eq('id', id).maybeSingle()
        : await supabaseAdmin.from('interview_letter_projects').select('id').eq('id', id).maybeSingle()
    if (!data || (body.kind === 'brief' && (data as { doc_type?: string }).doc_type !== 'editorial_brief')) {
      return NextResponse.json({ error: 'That document is not available.' }, { status: 404 })
    }
  }

  // Status guard first (see touchPresentation): nothing changes once the
  // presentation has been submitted or approved by someone else meanwhile.
  const guard = await touchPresentation(bundle.presentation.id, actor.id, {}, bundle.presentation.status)
  if (guard.error) return NextResponse.json({ error: guard.error.message }, { status: 500 })
  if (guard.conflict) return statusChangedResponse()

  const patch =
    body.kind === 'brief'
      ? { editorial_brief_id: id, editorial_brief_source: id ? source : null }
      : { interview_letter_id: id, interview_letter_source: id ? source : null }
  const { error } = await supabaseAdmin.from('projects').update({ ...patch, updated_by: actor.id }).eq('id', bundle.project.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (id) {
    await recordPresentationEvent(bundle.presentation.id, `${body.kind === 'brief' ? 'brief' : 'letter'}_${source}`, actor.id)
  }

  const fresh = await loadPresentationBundle(params.id)
  return NextResponse.json(await buildWorkspaceState(fresh!, actor))
}
