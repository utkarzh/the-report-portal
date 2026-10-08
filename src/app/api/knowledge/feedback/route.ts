import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { accessibleDepartmentIds, getKbActor } from '@/lib/knowledge/access'
import { isHttpUrl } from '@/lib/knowledge/items'
import type { KnowledgeRating, KnowledgeSource } from '@/types'

const RATINGS: KnowledgeRating[] = ['helpful', 'unclear', 'incorrect', 'outdated', 'missing']

// POST /api/knowledge/feedback — a rating on an answer (US-115) or a
// suggestion (US-116). Everything except "Helpful" is routed to the
// department of the answer's first cited source, or — when the answer had no
// source (a "no approved answer" reply) — to the user's department.
export async function POST(request: NextRequest) {
  const { actor, response } = await getKbActor()
  if (!actor) return response

  const body = (await request.json().catch(() => ({}))) as {
    kind?: 'feedback' | 'suggestion'
    rating?: KnowledgeRating
    suggestionType?: 'change' | 'new'
    comment?: string
    messageId?: string
    itemId?: string
    departmentId?: string
    linkUrl?: string
    attachment?: { path?: string; name?: string }
  }
  const comment = (body.comment || '').trim().slice(0, 4000)
  const myDepartments = await accessibleDepartmentIds(actor)

  // The answer this is about (must be the caller's own chat).
  let firstSource: KnowledgeSource | null = null
  let messageId: string | null = null
  if (body.messageId) {
    const { data: msg } = await supabaseAdmin
      .from('knowledge_messages')
      .select('id, role, sources, chat_id')
      .eq('id', body.messageId)
      .maybeSingle()
    const { data: chat } = msg
      ? await supabaseAdmin.from('knowledge_chats').select('user_id').eq('id', msg.chat_id).maybeSingle()
      : { data: null }
    if (!msg || msg.role !== 'assistant' || chat?.user_id !== actor.id) {
      return NextResponse.json({ error: 'Answer not found' }, { status: 404 })
    }
    messageId = msg.id
    const sources = (msg.sources || []) as KnowledgeSource[]
    firstSource = sources.find((s) => s.cited) ?? sources[0] ?? null
  }

  // Fallback routing when nothing else names a department.
  const pickDepartment = (): string | null => {
    if (body.departmentId && myDepartments.includes(body.departmentId)) return body.departmentId
    return myDepartments.length === 1 ? myDepartments[0] : null
  }

  if (body.kind === 'feedback') {
    if (!body.rating || !RATINGS.includes(body.rating)) return NextResponse.json({ error: 'Choose a rating.' }, { status: 400 })
    if (!messageId) return NextResponse.json({ error: 'Feedback must be about an answer.' }, { status: 400 })
    const helpful = body.rating === 'helpful'
    const departmentId = firstSource?.department_id ?? pickDepartment()
    if (!helpful && !departmentId) {
      return NextResponse.json({ error: 'Choose which department should review this.', needsDepartment: true }, { status: 400 })
    }
    // One current rating per answer per person: re-rating replaces it unless
    // the Guardian has already acted on the old one.
    await supabaseAdmin
      .from('knowledge_feedback')
      .delete()
      .eq('kind', 'feedback')
      .eq('message_id', messageId)
      .eq('user_id', actor.id)
      .in('status', ['open', 'done'])
    const { data, error } = await supabaseAdmin
      .from('knowledge_feedback')
      .insert({
        kind: 'feedback',
        rating: body.rating,
        comment,
        user_id: actor.id,
        department_id: departmentId,
        item_id: firstSource?.item_id ?? null,
        message_id: messageId,
        // "Helpful" is recorded but never queued for the Guardian.
        status: helpful ? 'done' : 'open',
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ feedback: data })
  }

  if (body.kind === 'suggestion') {
    const suggestionType = body.suggestionType === 'new' ? 'new' : 'change'
    if (!comment) return NextResponse.json({ error: 'Describe your suggestion.' }, { status: 400 })

    let departmentId: string | null = null
    let itemId: string | null = null
    if (body.itemId) {
      const { data: item } = await supabaseAdmin
        .from('knowledge_items')
        .select('id, department_id, status')
        .eq('id', body.itemId)
        .maybeSingle()
      if (!item || item.status !== 'published' || !myDepartments.includes(item.department_id)) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }
      itemId = item.id
      departmentId = item.department_id
    } else if (firstSource) {
      itemId = firstSource.item_id
      departmentId = firstSource.department_id
    } else {
      departmentId = pickDepartment()
    }
    if (!departmentId) {
      return NextResponse.json({ error: 'Choose which department this is for.', needsDepartment: true }, { status: 400 })
    }

    const linkUrl = (body.linkUrl || '').trim()
    if (linkUrl && !isHttpUrl(linkUrl)) return NextResponse.json({ error: 'Links must start with https://' }, { status: 400 })
    const att = body.attachment
    if (att?.path && !att.path.startsWith(`${departmentId}/suggestions/${actor.id}/`)) {
      return NextResponse.json({ error: 'Invalid attachment' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('knowledge_feedback')
      .insert({
        kind: 'suggestion',
        suggestion_type: suggestionType,
        comment,
        link_url: linkUrl || null,
        attachment_path: att?.path || null,
        attachment_name: att?.path ? att.name || 'Attachment' : null,
        user_id: actor.id,
        department_id: departmentId,
        item_id: itemId,
        message_id: messageId,
        status: 'open',
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ feedback: data })
  }

  return NextResponse.json({ error: 'Unknown feedback type' }, { status: 400 })
}
