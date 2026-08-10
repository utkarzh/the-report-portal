import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isInterviewType } from '@/lib/meeting-prep'

interface Params {
  params: { variant: string }
}

// GET — any authenticated user may read (needed at planteo generation time).
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isInterviewType(params.variant)) {
    return NextResponse.json({ error: 'Invalid variant' }, { status: 400 })
  }

  const { data } = await supabase
    .from('meeting_prep_planteo_library')
    .select('template_text')
    .eq('variant', params.variant)
    .maybeSingle()

  return NextResponse.json({ templateText: data?.template_text || '' })
}

// PATCH — admin only, snapshots the previous version before overwriting.
export async function PATCH(request: NextRequest, { params }: Params) {
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

  if (!isInterviewType(params.variant)) {
    return NextResponse.json({ error: 'Invalid variant' }, { status: 400 })
  }

  const { templateText } = await request.json()
  if (typeof templateText !== 'string') {
    return NextResponse.json({ error: 'templateText is required' }, { status: 400 })
  }

  const { data: current } = await supabaseAdmin
    .from('meeting_prep_planteo_library')
    .select('id, template_text')
    .eq('variant', params.variant)
    .maybeSingle()

  if (!current) {
    return NextResponse.json({ error: 'Planteo library row not found for this variant' }, { status: 404 })
  }

  // The brief requires every update to the planteo document be logged —
  // snapshot the current text before overwriting.
  const { error: versionError } = await supabaseAdmin
    .from('meeting_prep_planteo_library_versions')
    .insert({ variant: params.variant, template_text: current.template_text, saved_by: user.id })
  if (versionError) {
    return NextResponse.json({ error: 'Failed to snapshot version: ' + versionError.message }, { status: 500 })
  }

  const { error } = await supabaseAdmin
    .from('meeting_prep_planteo_library')
    .update({ template_text: templateText, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
