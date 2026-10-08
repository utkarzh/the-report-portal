import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardian } from '@/lib/knowledge/access'
import { ensureDraft } from '@/lib/knowledge/items'
import type { KnowledgeFeedback, KnowledgeItem } from '@/types'

// PATCH /api/knowledge/feedback/[id] — the Guardian acts on a queue entry
// (US-117): { action: 'accept' | 'decline' | 'done' | 'reopen', note? }.
// Accepting opens the source item as a draft (creating one from the published
// version if needed) and returns where to edit it; nothing a user suggested
// ever changes knowledge until the Guardian edits and publishes it (US-116).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response

  const { data: row } = await supabaseAdmin.from('knowledge_feedback').select('*').eq('id', params.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const fb = row as KnowledgeFeedback
  if (!fb.department_id) return NextResponse.json({ error: 'This entry isn’t routed to a department.' }, { status: 400 })
  const g = await requireGuardian(actor, fb.department_id)
  if (!g.department) return g.response

  const body = (await request.json().catch(() => ({}))) as { action?: string; note?: string }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : undefined
  const resolved = { resolved_by: actor.id, resolved_at: new Date().toISOString() }

  let redirect: string | null = null
  let updates: Record<string, unknown>
  switch (body.action) {
    case 'accept': {
      updates = { status: 'accepted', ...resolved, ...(note !== undefined ? { guardian_note: note } : {}) }
      const base = `/knowledge/manage/${fb.department_id}`
      if (fb.item_id) {
        const { data: itemRow } = await supabaseAdmin.from('knowledge_items').select('*').eq('id', fb.item_id).maybeSingle()
        const item = itemRow as KnowledgeItem | null
        if (item && item.department_id === fb.department_id && item.status !== 'archived') {
          if (item.published_version_id) {
            try {
              await ensureDraft(item, actor.id)
            } catch {
              /* the editor offers Edit if this failed */
            }
          }
          redirect = `${base}/items/${item.id}`
        }
      }
      if (!redirect) redirect = `${base}/new?type=text&fromFeedback=${fb.id}`
      break
    }
    case 'decline':
      updates = { status: 'declined', ...resolved, guardian_note: note ?? fb.guardian_note }
      break
    case 'done':
      updates = { status: 'done', ...resolved, ...(note !== undefined ? { guardian_note: note } : {}) }
      break
    case 'reopen':
      updates = { status: 'open', resolved_by: null, resolved_at: null }
      break
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('knowledge_feedback').update(updates).eq('id', fb.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ feedback: data, redirect })
}
