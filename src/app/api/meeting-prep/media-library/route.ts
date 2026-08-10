import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET — any authenticated user may read (needed at Step 1's media-profile lookup).
export async function GET() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('meeting_prep_media_library')
    .select('*')
    .order('publication_name', { ascending: true })

  return NextResponse.json(data || [])
}

// POST — admin only, creates a publication profile.
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { publicationName, positioningStatement, audienceReach, editorialNarrativeFocus, countryOfPublication } = body

  if (!publicationName || !countryOfPublication) {
    return NextResponse.json({ error: 'publicationName and countryOfPublication are required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('meeting_prep_media_library')
    .insert({
      publication_name: publicationName,
      positioning_statement: positioningStatement || '',
      audience_reach: audienceReach || '',
      editorial_narrative_focus: editorialNarrativeFocus || '',
      country_of_publication: countryOfPublication,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A publication with this name already exists.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidatePath('/admin/meeting-prep/media-library')
  return NextResponse.json(data, { status: 201 })
}
