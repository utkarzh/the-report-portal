import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { recordPresentationEvent, requirePresentationActor } from '@/lib/commercial-presentations-server'
import { DEFAULT_LANGUAGE, PRESENTATION_LANGUAGES, defaultProjectName } from '@/lib/commercial-presentations'

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// POST — create a Project (agency + country + media + edition) and its
// Commercial Presentation. No AI call. The same project combination can't get
// two presentations (it's generated at project level); asking again returns
// 409 with the existing presentation's id so the UI can open it.
export async function POST(request: NextRequest) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const s = (k: string, max = 300) => (typeof body[k] === 'string' ? (body[k] as string).trim().slice(0, max) : '')
  const agencyId = s('agencyId', 64)
  const mediaId = s('mediaId', 64)
  const country = s('country', 120)
  const edition = s('edition', 60)
  const anchorEvent = s('anchorEvent', 300)
  const anchorDate = s('anchorDate', 120)
  const language = PRESENTATION_LANGUAGES.some((l) => l.value === s('language') && l.available) ? s('language') : DEFAULT_LANGUAGE

  if (!agencyId || !mediaId || !country) {
    return NextResponse.json({ error: 'Agency, country and media are required.' }, { status: 400 })
  }

  const [{ data: agency }, { data: media }] = await Promise.all([
    supabaseAdmin.from('agencies').select('id, name, active').eq('id', agencyId).maybeSingle(),
    supabaseAdmin.from('media_library').select('id, name').eq('id', mediaId).maybeSingle(),
  ])
  if (!agency || !agency.active) return NextResponse.json({ error: 'That agency is not available.' }, { status: 400 })
  if (!media) return NextResponse.json({ error: 'That media is not in the Media Library.' }, { status: 400 })

  // Same agency + country + media + edition = the same project.
  const { data: candidates } = await supabaseAdmin
    .from('projects')
    .select('id, country, edition')
    .eq('agency_id', agency.id)
    .eq('media_id', media.id)
  const existing = (candidates || []).find((p) => norm(p.country) === norm(country) && norm(p.edition) === norm(edition))

  let projectId = existing?.id as string | undefined
  if (projectId) {
    const { data: already } = await supabaseAdmin.from('commercial_presentations').select('id').eq('project_id', projectId).maybeSingle()
    if (already) {
      return NextResponse.json(
        { error: 'This project already has a presentation.', existingId: already.id },
        { status: 409 },
      )
    }
  } else {
    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .insert({
        name: s('name', 200) || defaultProjectName({ country, mediaName: media.name, edition }),
        agency_id: agency.id,
        agency_name: agency.name,
        country,
        media_id: media.id,
        media_name: media.name,
        edition,
        anchor_event: anchorEvent,
        anchor_date: anchorDate,
        created_by: actor.id,
        updated_by: actor.id,
      })
      .select('id')
      .single()
    if (error || !project) return NextResponse.json({ error: error?.message || 'Failed to create the project' }, { status: 500 })
    projectId = project.id
  }

  const { data: presentation, error } = await supabaseAdmin
    .from('commercial_presentations')
    .insert({ project_id: projectId, language, created_by: actor.id, updated_by: actor.id })
    .select('id')
    .single()
  if (error || !presentation) return NextResponse.json({ error: error?.message || 'Failed to create the presentation' }, { status: 500 })

  await recordPresentationEvent(presentation.id, 'created', actor.id)
  return NextResponse.json({ id: presentation.id }, { status: 201 })
}
