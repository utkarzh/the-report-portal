import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { canViewDepartment, getKbActor } from '@/lib/knowledge/access'
import { loadVersion } from '@/lib/knowledge/items'
import { KNOWLEDGE_BUCKET } from '@/lib/knowledge/constants'
import type { KnowledgeDepartment, KnowledgeItem } from '@/types'

// GET /api/knowledge/items/[id]/download[?versionId=] — opens/downloads an
// item (US-110, US-114). Users get ONLY the current published version of a
// live item in one of their departments; any other version (drafts, history,
// archived items) is for the department's Guardian and platform admins.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response

  const { data: itemRow } = await supabaseAdmin.from('knowledge_items').select('*').eq('id', params.id).maybeSingle()
  if (!itemRow) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  const item = itemRow as KnowledgeItem
  const { data: deptRow } = await supabaseAdmin.from('knowledge_departments').select('*').eq('id', item.department_id).single()
  const dept = deptRow as KnowledgeDepartment
  const isManager = actor.role === 'admin' || dept.guardian_id === actor.id

  const requested = request.nextUrl.searchParams.get('versionId')
  const versionId = requested || item.published_version_id
  const isLive = versionId === item.published_version_id && item.status === 'published'

  if (!isManager) {
    if (!isLive || !(await canViewDepartment(actor, item.department_id))) {
      return NextResponse.json({ error: 'This item isn’t available.' }, { status: 404 })
    }
  }
  const version = await loadVersion(versionId)
  if (!version || version.item_id !== item.id) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  if (version.file_path) {
    const { data, error } = await supabaseAdmin.storage
      .from(KNOWLEDGE_BUCKET)
      .createSignedUrl(version.file_path, 120, { download: version.file_name || true })
    if (error || !data) return NextResponse.json({ error: 'Could not open the file.' }, { status: 500 })
    return NextResponse.redirect(data.signedUrl)
  }
  if (version.url) return NextResponse.redirect(version.url)

  const safe = (version.title || 'guide').replace(/[^a-zA-Z0-9 \-_]/g, '').trim() || 'guide'
  return new NextResponse(`# ${version.title}\n\n${version.description ? `${version.description}\n\n` : ''}${version.content}\n`, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}.md"`,
    },
  })
}
