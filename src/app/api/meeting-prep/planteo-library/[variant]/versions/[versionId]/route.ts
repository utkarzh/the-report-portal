import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isInterviewType } from '@/lib/meeting-prep'

interface Params {
  params: { variant: string; versionId: string }
}

async function requireAdmin() {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? user : null
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabaseAdmin
    .from('meeting_prep_planteo_library_versions')
    .delete()
    .eq('id', params.versionId)
    .eq('variant', params.variant)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// POST — restore a prior version. Snapshots the current text first, same as
// every other prompt-history restore in this app.
export async function POST(_req: NextRequest, { params }: Params) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!isInterviewType(params.variant)) {
    return NextResponse.json({ error: 'Invalid variant' }, { status: 400 })
  }

  const { data: version } = await supabaseAdmin
    .from('meeting_prep_planteo_library_versions')
    .select('template_text')
    .eq('id', params.versionId)
    .eq('variant', params.variant)
    .single()

  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const { data: current } = await supabaseAdmin
    .from('meeting_prep_planteo_library')
    .select('id, template_text')
    .eq('variant', params.variant)
    .single()

  if (!current) return NextResponse.json({ error: 'Planteo library row not found' }, { status: 404 })

  await supabaseAdmin
    .from('meeting_prep_planteo_library_versions')
    .insert({ variant: params.variant, template_text: current.template_text, saved_by: user.id })

  const { error } = await supabaseAdmin
    .from('meeting_prep_planteo_library')
    .update({ template_text: version.template_text, updated_by: user.id })
    .eq('id', current.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, promptText: version.template_text })
}
