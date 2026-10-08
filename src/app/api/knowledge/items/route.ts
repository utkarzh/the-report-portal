import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardian } from '@/lib/knowledge/access'
import { isHttpUrl, titleFromFilename } from '@/lib/knowledge/items'
import { UPLOAD_EXT_RE } from '@/lib/knowledge/constants'
import type { KnowledgeItemType } from '@/types'

const TYPES: KnowledgeItemType[] = ['document', 'text', 'video', 'link']

// POST /api/knowledge/items — Guardian creates an item. Every new item starts
// as a draft and is invisible to users and the AI until published (US-102,
// US-105). Document uploads arrive as a storage path (the browser already
// uploaded the file via a signed URL); text extraction is kicked off
// separately by the client so this request stays fast.
export async function POST(request: NextRequest) {
  const { actor, response } = await getKbActor()
  if (!actor) return response

  const body = (await request.json().catch(() => ({}))) as {
    departmentId?: string
    topicId?: string | null
    type?: KnowledgeItemType
    title?: string
    description?: string
    content?: string
    url?: string
    file?: { path?: string; name?: string; mime?: string | null; size?: number }
  }
  if (!body.departmentId || !body.type || !TYPES.includes(body.type)) {
    return NextResponse.json({ error: 'departmentId and a valid type are required' }, { status: 400 })
  }
  const g = await requireGuardian(actor, body.departmentId)
  if (!g.department) return g.response

  let topicId: string | null = body.topicId || null
  if (topicId) {
    const { data: topic } = await supabaseAdmin.from('knowledge_topics').select('department_id').eq('id', topicId).maybeSingle()
    if (!topic || topic.department_id !== body.departmentId) topicId = null
  }

  const description = (body.description || '').trim()
  const version: Record<string, unknown> = { version_number: 1, description, created_by: actor.id }
  let title = (body.title || '').trim()

  if (body.type === 'document') {
    const f = body.file
    if (!f?.path || !f.name) return NextResponse.json({ error: 'Upload a file first.' }, { status: 400 })
    if (!f.path.startsWith(`${body.departmentId}/items/`)) return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
    if (!UPLOAD_EXT_RE.test(f.name)) return NextResponse.json({ error: 'Upload a PDF, Word (.docx) or plain text file.' }, { status: 400 })
    title = title || titleFromFilename(f.name)
    Object.assign(version, {
      file_path: f.path,
      file_name: f.name,
      file_mime: f.mime || null,
      file_size: f.size ?? null,
      extraction_status: 'pending',
    })
  } else if (body.type === 'text') {
    const content = (body.content || '').trim()
    if (!title) return NextResponse.json({ error: 'Give the guide a title.' }, { status: 400 })
    if (!content) return NextResponse.json({ error: 'Write some content first.' }, { status: 400 })
    Object.assign(version, { content, char_count: content.length })
  } else {
    const url = (body.url || '').trim()
    if (!title) return NextResponse.json({ error: 'Give the link a title.' }, { status: 400 })
    if (!isHttpUrl(url)) return NextResponse.json({ error: 'Enter a full link starting with https://' }, { status: 400 })
    version.url = url
  }
  if (title.length > 200) title = title.slice(0, 200)
  version.title = title

  const { data: item, error: itemError } = await supabaseAdmin
    .from('knowledge_items')
    .insert({
      department_id: body.departmentId,
      topic_id: topicId,
      type: body.type,
      title,
      description,
      status: 'draft',
      created_by: actor.id,
    })
    .select('*')
    .single()
  if (itemError || !item) return NextResponse.json({ error: itemError?.message || 'Could not create item' }, { status: 500 })

  const { data: v, error: vError } = await supabaseAdmin
    .from('knowledge_item_versions')
    .insert({ ...version, item_id: item.id })
    .select('*')
    .single()
  if (vError || !v) {
    await supabaseAdmin.from('knowledge_items').delete().eq('id', item.id)
    return NextResponse.json({ error: vError?.message || 'Could not create item' }, { status: 500 })
  }
  await supabaseAdmin.from('knowledge_items').update({ draft_version_id: v.id }).eq('id', item.id)

  return NextResponse.json({ item: { ...item, draft_version_id: v.id }, version: v })
}
