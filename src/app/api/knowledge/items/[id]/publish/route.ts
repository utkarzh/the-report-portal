import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor, requireGuardianForItem } from '@/lib/knowledge/access'
import { loadVersion } from '@/lib/knowledge/items'
import { indexVersion } from '@/lib/knowledge/indexing'

export const maxDuration = 300
// Leave headroom under maxDuration for the pointer flip and response.
const SLICE_MS = 240_000

// POST /api/knowledge/items/[id]/publish — only the department's Guardian
// (US-105). Indexes the draft first (resumable: returns { done: false } with
// progress until finished, and the client calls again), then makes it live in
// ONE update of the item's published pointer — so search switches from the old
// version to the new one atomically, never showing both (US-106).
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const started = Date.now()
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const g = await requireGuardianForItem(actor, params.id)
  if (!g.item) return g.response
  const item = g.item

  if (item.status === 'archived') return NextResponse.json({ error: 'Restore this item from the archive before publishing.' }, { status: 409 })
  const draft = await loadVersion(item.draft_version_id)
  if (!draft) return NextResponse.json({ error: 'There are no draft changes to publish.' }, { status: 409 })

  if (item.type === 'document') {
    if (draft.extraction_status === 'needs_attention' || draft.extraction_status === 'failed') {
      return NextResponse.json({ error: draft.extraction_error || 'This file has no readable text, so it can’t be published.' }, { status: 422 })
    }
    if (draft.extraction_status !== 'ready') {
      return NextResponse.json({ error: 'This file is still being processed. Try again once it shows Ready.' }, { status: 409 })
    }
  }
  if (item.type === 'text' && !draft.content.trim()) {
    return NextResponse.json({ error: 'Write some content before publishing.' }, { status: 422 })
  }
  if ((item.type === 'video' || item.type === 'link') && !draft.url) {
    return NextResponse.json({ error: 'Add the link before publishing.' }, { status: 422 })
  }

  let progress
  try {
    progress = await indexVersion({ item, version: draft, userId: actor.id, deadlineAt: started + SLICE_MS })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Indexing failed' }, { status: 500 })
  }
  if (!progress.done) return NextResponse.json({ done: false, total: progress.total, embedded: progress.embedded })

  const now = new Date().toISOString()
  const previousVersionId = item.published_version_id

  await supabaseAdmin
    .from('knowledge_item_versions')
    .update({ published_at: now, published_by: actor.id })
    .eq('id', draft.id)

  // The flip. Guarded on draft_version_id so a concurrent discard/publish
  // can't publish a version that is no longer the draft.
  const { data: flipped, error } = await supabaseAdmin
    .from('knowledge_items')
    .update({
      published_version_id: draft.id,
      draft_version_id: null,
      status: 'published',
      title: draft.title,
      description: draft.description,
      last_published_at: now,
    })
    .eq('id', item.id)
    .eq('draft_version_id', draft.id)
    .select('*')
    .maybeSingle()
  if (error || !flipped) {
    await supabaseAdmin.from('knowledge_item_versions').update({ published_at: null, published_by: null }).eq('id', draft.id)
    return NextResponse.json({ error: error?.message || 'The draft changed while publishing — reload and try again.' }, { status: 409 })
  }

  // The superseded version is out of search already (pointer moved); drop its
  // passages to keep the index lean. The version row itself is kept for audit
  // and restore (US-100, US-105) — restoring re-indexes it as a new draft.
  if (previousVersionId && previousVersionId !== draft.id) {
    await supabaseAdmin.from('knowledge_chunks').delete().eq('version_id', previousVersionId)
    await supabaseAdmin
      .from('knowledge_item_versions')
      .update({ index_status: 'not_indexed', chunk_count: 0 })
      .eq('id', previousVersionId)
  }

  return NextResponse.json({ done: true, item: flipped })
}
