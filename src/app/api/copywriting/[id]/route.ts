import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { denyWithoutCopywritingAccess } from '@/lib/copywriting-access'
import { PROJECT_DOCUMENTS_BUCKET, COPYWRITING_IMAGES_BUCKET } from '@/lib/copywriting'
import { loadProjectImages } from '@/lib/copywriting-images'

interface Params {
  params: { id: string }
}

async function loadProjectForUser(id: string, userId: string) {
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  const { data: project } = await supabaseAdmin.from('copywriting_projects').select('*').eq('id', id).maybeSingle()
  if (!project) return { project: null, profile, isOwnerOrAdmin: false }
  const isOwnerOrAdmin = project.user_id === userId || profile?.role === 'admin'
  return { project, profile, isOwnerOrAdmin }
}

// GET — full project detail: the project row, its uploaded sources, research
// ledger, chat history and step-by-step event log (FLOW: "clicking a card
// opens... the complete step-by-step history").
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const { project, isOwnerOrAdmin } = await loadProjectForUser(params.id, auth.user.id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isOwnerOrAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [{ data: documents }, { data: research }, { data: messages }, { data: events }] = await Promise.all([
    supabaseAdmin.from('copywriting_project_documents').select('id, project_id, user_id, filename, storage_path, mime, size_bytes, char_count, truncated, created_at').eq('project_id', project.id).order('created_at'),
    supabaseAdmin.from('copywriting_research_entries').select('*').eq('project_id', project.id).order('created_at'),
    supabaseAdmin.from('copywriting_messages').select('*').eq('project_id', project.id).order('created_at'),
    supabaseAdmin.from('copywriting_project_events').select('*').eq('project_id', project.id).order('created_at'),
  ])
  const images = await loadProjectImages(project.id)

  return NextResponse.json({
    project,
    documents: documents || [],
    research: research || [],
    messages: messages || [],
    events: events || [],
    images,
  })
}

// DELETE — admin only (Comment 1, HOME-02). Cleans up the project's uploaded
// source files from storage before deleting the row (children cascade).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: docs } = await supabaseAdmin
    .from('copywriting_project_documents')
    .select('storage_path')
    .eq('project_id', params.id)

  if (docs?.length) {
    await supabaseAdmin.storage.from(PROJECT_DOCUMENTS_BUCKET).remove(docs.map((d) => d.storage_path))
  }
  const { data: imgs } = await supabaseAdmin
    .from('copywriting_project_images')
    .select('storage_path')
    .eq('project_id', params.id)
  if (imgs?.length) {
    await supabaseAdmin.storage.from(COPYWRITING_IMAGES_BUCKET).remove(imgs.map((i) => i.storage_path))
  }

  const { error } = await supabaseAdmin.from('copywriting_projects').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
