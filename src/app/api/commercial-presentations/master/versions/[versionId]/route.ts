import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminActor, requirePresentationActor } from '@/lib/commercial-presentations-server'

interface Params {
  params: { versionId: string }
}

// POST — make an earlier version live again, as it is. No new version is
// created: the restored version goes live under its OWN label (e.g. v0.2) and
// leaves the history, while the content that was live moves into the history
// under its label. So the history never holds two copies of one version, and
// a presentation approved on v0.2 reads as up to date again once v0.2 is back.
// Saving unsaved edits first is the client's job (it asks), via the normal PUT.
export async function POST(_req: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied

  const { data: version } = await supabaseAdmin.from('presentation_master_versions').select('*').eq('id', params.versionId).maybeSingle()
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  const { data: current } = await supabaseAdmin.from('presentation_master_content').select('*').eq('id', version.content_id).maybeSingle()
  if (!current) return NextResponse.json({ error: 'Master content not found' }, { status: 404 })

  const { data: snap, error: snapError } = await supabaseAdmin
    .from('presentation_master_versions')
    .insert({ content_id: current.id, content: current.content, version_label: current.version_label, saved_by: current.updated_by })
    .select('id')
    .single()
  if (snapError || !snap) return NextResponse.json({ error: `Failed to keep the current version: ${snapError?.message}` }, { status: 500 })

  // Guarded on the label read above, so two admins restoring at once can't
  // both swap (the loser's snapshot is removed again).
  const { data: row, error } = await supabaseAdmin
    .from('presentation_master_content')
    .update({ content: version.content, version_label: version.version_label, updated_by: actor.id, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .eq('version_label', current.version_label)
    .select('*')
    .maybeSingle()
  if (error || !row) {
    await supabaseAdmin.from('presentation_master_versions').delete().eq('id', snap.id)
    return NextResponse.json({ error: error?.message || 'This content changed while restoring. Reload and try again.' }, { status: error ? 500 : 409 })
  }

  await supabaseAdmin.from('presentation_master_versions').delete().eq('id', version.id)
  return NextResponse.json({ row })
}

// DELETE — remove one saved version from the history. The live content and
// every approved presentation's snapshot are unaffected.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied
  const { error } = await supabaseAdmin.from('presentation_master_versions').delete().eq('id', params.versionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
