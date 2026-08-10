import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params {
  params: { id: string }
}

async function getAdminUser() {
  try {
    const supabase = createSupabaseServerClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return null
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', session.user.id).single()
    return profile?.role === 'admin' ? session.user : null
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin.from('meeting_prep_media_library').select('*').eq('id', params.id).single()
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getAdminUser()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    const { publicationName, positioningStatement, audienceReach, editorialNarrativeFocus, countryOfPublication } = body

    const updates: Record<string, unknown> = {}
    if (publicationName !== undefined) updates.publication_name = publicationName
    if (positioningStatement !== undefined) updates.positioning_statement = positioningStatement
    if (audienceReach !== undefined) updates.audience_reach = audienceReach
    if (editorialNarrativeFocus !== undefined) updates.editorial_narrative_focus = editorialNarrativeFocus
    if (countryOfPublication !== undefined) updates.country_of_publication = countryOfPublication

    const { error } = await supabaseAdmin
      .from('meeting_prep_media_library')
      .update(updates)
      .eq('id', params.id)

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A publication with this name already exists.' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/meeting-prep/media-library/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getAdminUser()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Hard delete — meeting_prep_sessions.media_library_id is SET NULL so
    // past sessions keep their snapshotted media fields regardless.
    const { error } = await supabaseAdmin
      .from('meeting_prep_media_library')
      .delete()
      .eq('id', params.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/meeting-prep/media-library/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
