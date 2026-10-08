import { supabaseAdmin } from '@/lib/supabase/admin'
import { displayName } from '@/lib/knowledge/access'
import { itemDisplayState, isExtractionStalled, type ItemDisplayState } from '@/lib/knowledge/constants'
import type { KnowledgeFeedback, KnowledgeItem, KnowledgeItemVersion, KnowledgeTopic } from '@/types'
import type { ReviewEntry } from '@/components/knowledge/ReviewQueue'

// Server-side loaders shared by the Guardian's manage pages and the admin
// department page.

export interface ContentRow {
  item: KnowledgeItem
  topicName: string | null
  state: ItemDisplayState
  openFeedback: number
  draft: Pick<KnowledgeItemVersion, 'id' | 'extraction_status' | 'extraction_error' | 'extraction_started_at' | 'updated_at'> | null
  stalled: boolean
}

// Version columns safe to load in bulk (never the extracted text body).
export const LEAN_VERSION_COLUMNS =
  'id, item_id, version_number, title, description, url, file_path, file_name, file_mime, file_size, char_count, extraction_status, extraction_error, extraction_started_at, index_status, chunk_count, restored_from_version_id, created_by, created_at, updated_at, published_at, published_by'

export async function loadDepartmentContent(departmentId: string): Promise<{
  topics: KnowledgeTopic[]
  rows: ContentRow[]
  counts: Record<string, number>
}> {
  const [{ data: topics }, { data: items }, { data: feedback }] = await Promise.all([
    supabaseAdmin.from('knowledge_topics').select('*').eq('department_id', departmentId).order('position').order('name'),
    supabaseAdmin.from('knowledge_items').select('*').eq('department_id', departmentId).order('updated_at', { ascending: false }),
    supabaseAdmin.from('knowledge_feedback').select('item_id').eq('department_id', departmentId).eq('status', 'open'),
  ])
  const draftIds = (items || []).map((i) => i.draft_version_id).filter(Boolean) as string[]
  const { data: drafts } = draftIds.length
    ? await supabaseAdmin
        .from('knowledge_item_versions')
        .select('id, extraction_status, extraction_error, extraction_started_at, updated_at')
        .in('id', draftIds)
    : { data: [] as ContentRow['draft'][] }
  const draftMap = new Map((drafts || []).map((d) => [d!.id, d!]))
  const topicMap = new Map((topics || []).map((t) => [t.id, t.name as string]))
  const fbCount = new Map<string, number>()
  for (const f of feedback || []) if (f.item_id) fbCount.set(f.item_id, (fbCount.get(f.item_id) ?? 0) + 1)

  const counts: Record<string, number> = { __all: 0, __unsorted: 0 }
  const rows: ContentRow[] = ((items || []) as KnowledgeItem[]).map((item) => {
    const draft = item.draft_version_id ? draftMap.get(item.draft_version_id) ?? null : null
    counts.__all++
    if (item.topic_id && topicMap.has(item.topic_id)) counts[item.topic_id] = (counts[item.topic_id] ?? 0) + 1
    else counts.__unsorted++
    return {
      item,
      topicName: item.topic_id ? topicMap.get(item.topic_id) ?? null : null,
      state: itemDisplayState(item, draft),
      openFeedback: fbCount.get(item.id) ?? 0,
      draft,
      stalled: !!draft && isExtractionStalled(draft),
    }
  })
  return { topics: (topics || []) as KnowledgeTopic[], rows, counts }
}

export async function loadReviewEntries(departmentId: string, status: 'open' | 'all'): Promise<ReviewEntry[]> {
  // Suggestions + every non-"Helpful" rating ("Helpful" never reaches a Guardian).
  let q = supabaseAdmin
    .from('knowledge_feedback')
    .select('*')
    .eq('department_id', departmentId)
    .or('kind.eq.suggestion,rating.neq.helpful')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status === 'open') q = q.eq('status', 'open')
  const { data } = await q
  const rows = (data || []) as KnowledgeFeedback[]

  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean))) as string[]
  const itemIds = Array.from(new Set(rows.map((r) => r.item_id).filter(Boolean))) as string[]
  const messageIds = Array.from(new Set(rows.map((r) => r.message_id).filter(Boolean))) as string[]
  const [{ data: users }, { data: items }, { data: answers }] = await Promise.all([
    userIds.length ? supabaseAdmin.from('profiles').select('id, full_name, email').in('id', userIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    itemIds.length ? supabaseAdmin.from('knowledge_items').select('id, title').in('id', itemIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    messageIds.length
      ? supabaseAdmin.from('knowledge_messages').select('id, chat_id, content, created_at').in('id', messageIds)
      : Promise.resolve({ data: [] as { id: string; chat_id: string; content: string; created_at: string }[] }),
  ])
  // The question = the user message just before each answer in its chat.
  const questions = new Map<string, string>()
  for (const a of answers || []) {
    const { data: q2 } = await supabaseAdmin
      .from('knowledge_messages')
      .select('content')
      .eq('chat_id', a.chat_id)
      .eq('role', 'user')
      .lt('created_at', a.created_at)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (q2) questions.set(a.id, q2.content)
  }
  const userMap = new Map((users || []).map((u) => [u.id, displayName(u)]))
  const itemMap = new Map((items || []).map((i) => [i.id, i.title as string]))
  const answerMap = new Map((answers || []).map((a) => [a.id, a.content as string]))

  return rows.map((r) => ({
    ...r,
    sender_name: r.user_id ? userMap.get(r.user_id) ?? null : null,
    item_title: r.item_id ? itemMap.get(r.item_id) ?? null : null,
    question: r.message_id ? questions.get(r.message_id) ?? null : null,
    answer: r.message_id ? answerMap.get(r.message_id) ?? null : null,
  }))
}
