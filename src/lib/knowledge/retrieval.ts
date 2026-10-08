import { supabaseAdmin } from '@/lib/supabase/admin'
import { embedTexts, embeddingCost, embeddingsEnabled } from '@/lib/knowledge/embeddings'
import { ITEM_TYPE_LABELS } from '@/lib/knowledge/constants'
import { formatDayMonthYear } from '@/lib/date-format'
import { displayName } from '@/lib/knowledge/access'
import type { KnowledgeItemType, KnowledgeSource } from '@/types'

// Retrieval for the Knowledge Base chat (US-109, US-110, US-123).
// Searches ONLY the departments passed in — the caller computes them from the
// user's live membership — via knowledge_search(), which itself only ever sees
// current published versions of non-archived items.

const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves trc company tell explain please want need know get got make give show way ways thing things like one`
    .split(/\s+/),
)

const MAX_ITEMS = 8
const MAX_CONTEXT_CHARS = 60_000

export interface RetrievedPassage {
  chunk_id: string
  item_id: string
  version_id: string
  department_id: string
  chunk_index: number
  heading: string
  content: string
  similarity: number | null
  score: number
}

// OR-joined lexemes of the meaningful words. Tokens are reduced to letters and
// digits only, so nothing the user types can break to_tsquery's syntax.
export function buildFtsQuery(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  const unique = Array.from(new Set(words)).slice(0, 16)
  return unique.length ? unique.join(' | ') : null
}

// US-109: "when asked for examples, show items marked Example of excellent work".
export function wantsExamples(text: string): boolean {
  return /\b(examples?|samples?|templates?|model answers?|good ones?|show me (?:a|an|some)|excellent work)\b/i.test(text)
}

async function search(
  departmentIds: string[],
  embedding: number[] | null,
  fts: string | null,
  matchCount: number,
  examplesOnly: boolean,
): Promise<RetrievedPassage[]> {
  const { data, error } = await supabaseAdmin.rpc('knowledge_search', {
    p_department_ids: departmentIds,
    p_query_embedding: embedding ? JSON.stringify(embedding) : null,
    p_fts_query: fts,
    p_match_count: matchCount,
    p_examples_only: examplesOnly,
    p_min_similarity: examplesOnly ? 0.18 : 0.25,
  })
  if (error) throw new Error(`Knowledge search failed: ${error.message}`)
  return (data || []).map((r: Record<string, unknown>) => ({
    chunk_id: r.chunk_id as string,
    item_id: r.item_id as string,
    version_id: r.version_id as string,
    department_id: r.department_id as string,
    chunk_index: r.chunk_index as number,
    heading: (r.heading as string) || '',
    content: r.content as string,
    similarity: (r.similarity as number | null) ?? null,
    score: Number(r.score) || 0,
  }))
}

export interface RetrievalResult {
  passages: RetrievedPassage[]
  embeddingTokens: number
  embeddingCostUsd: number
}

export async function retrievePassages(opts: {
  departmentIds: string[]
  question: string
  // Previous user turn, so a follow-up like "and for Spain?" still finds the
  // right material.
  previousQuestion?: string | null
}): Promise<RetrievalResult> {
  const { departmentIds, question, previousQuestion } = opts
  if (departmentIds.length === 0) return { passages: [], embeddingTokens: 0, embeddingCostUsd: 0 }

  let embedding: number[] | null = null
  let embeddingTokens = 0
  if (embeddingsEnabled()) {
    try {
      const input = previousQuestion ? `${previousQuestion}\n${question}` : question
      const res = await embedTexts([input])
      embedding = res.vectors[0] ?? null
      embeddingTokens = res.tokens
    } catch (err) {
      // Semantic search is an enhancement — fall back to full-text only.
      console.error('[knowledge] query embedding failed, using full-text only:', err)
    }
  }

  const fts = buildFtsQuery(question) ?? (previousQuestion ? buildFtsQuery(previousQuestion) : null)
  const main = await search(departmentIds, embedding, fts, 14, false)

  let passages = main
  if (wantsExamples(question)) {
    const examples = await search(departmentIds, embedding, fts, 6, true)
    const seen = new Set(main.map((p) => p.chunk_id))
    // Examples go first so they're never squeezed out by the context budget.
    passages = [...examples.filter((p) => !seen.has(p.chunk_id)), ...main]
  }
  return { passages, embeddingTokens, embeddingCostUsd: embeddingCost(embeddingTokens) }
}

export interface BuiltContext {
  sources: KnowledgeSource[] // ref-numbered, all marked cited=false until the answer is parsed
  contextBlock: string
  versionIds: string[]
}

// Groups passages by item (best-ranked item first, passages within an item in
// document order — so two sections of one large document are both present and
// citable, US-123) and attaches the metadata every answer must show (US-110).
export async function buildContext(passages: RetrievedPassage[]): Promise<BuiltContext> {
  const order: string[] = []
  const byItem = new Map<string, RetrievedPassage[]>()
  for (const p of passages) {
    if (!byItem.has(p.item_id)) {
      if (order.length >= MAX_ITEMS) continue
      order.push(p.item_id)
      byItem.set(p.item_id, [])
    }
    byItem.get(p.item_id)!.push(p)
  }
  if (order.length === 0) return { sources: [], contextBlock: '', versionIds: [] }

  const versionIds = order.map((id) => byItem.get(id)![0].version_id)
  const [{ data: items }, { data: versions }] = await Promise.all([
    supabaseAdmin
      .from('knowledge_items')
      .select('id, title, type, is_example, topic_id, department_id, last_published_at')
      .in('id', order),
    supabaseAdmin.from('knowledge_item_versions').select('id, url, file_name, published_at').in('id', versionIds),
  ])
  const itemMap = new Map((items || []).map((i) => [i.id as string, i]))
  const versionMap = new Map((versions || []).map((v) => [v.id as string, v]))
  const deptIds = Array.from(new Set((items || []).map((i) => i.department_id as string)))
  const topicIds = Array.from(new Set((items || []).map((i) => i.topic_id as string | null).filter(Boolean))) as string[]
  const [{ data: depts }, { data: topics }] = await Promise.all([
    supabaseAdmin.from('knowledge_departments').select('id, name, guardian_id').in('id', deptIds),
    topicIds.length
      ? supabaseAdmin.from('knowledge_topics').select('id, name').in('id', topicIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const guardianIds = Array.from(new Set((depts || []).map((d) => d.guardian_id as string | null).filter(Boolean))) as string[]
  const { data: guardians } = guardianIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', guardianIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] }
  const deptMap = new Map((depts || []).map((d) => [d.id as string, d]))
  const topicMap = new Map((topics || []).map((t) => [t.id as string, t.name as string]))
  const guardianMap = new Map((guardians || []).map((g) => [g.id as string, displayName(g)]))

  const sources: KnowledgeSource[] = []
  const blocks: string[] = []
  let budget = MAX_CONTEXT_CHARS
  for (const itemId of order) {
    const item = itemMap.get(itemId)
    if (!item) continue
    const ps = byItem.get(itemId)!.sort((a, b) => a.chunk_index - b.chunk_index)
    const version = versionMap.get(ps[0].version_id)
    const dept = deptMap.get(item.department_id as string)
    const ref = sources.length + 1
    const updated = (item.last_published_at as string | null) || (version?.published_at as string | null) || null
    const source: KnowledgeSource = {
      ref,
      item_id: itemId,
      version_id: ps[0].version_id,
      title: item.title as string,
      type: item.type as KnowledgeItemType,
      department_id: item.department_id as string,
      department_name: (dept?.name as string) || 'Department',
      guardian_name: dept?.guardian_id ? guardianMap.get(dept.guardian_id as string) ?? null : null,
      topic_name: item.topic_id ? topicMap.get(item.topic_id as string) ?? null : null,
      last_updated: updated,
      url: (version?.url as string | null) ?? null,
      file_name: (version?.file_name as string | null) ?? null,
      is_example: !!item.is_example,
      cited: false,
      headings: Array.from(new Set(ps.map((p) => p.heading).filter(Boolean))).slice(0, 4),
    }

    const header = [
      `[S${ref}] ${source.title}`,
      `${ITEM_TYPE_LABELS[source.type]} · ${source.department_name}${source.topic_name ? ` · ${source.topic_name}` : ''}${updated ? ` · last updated ${formatDayMonthYear(updated)}` : ''}${source.is_example ? ' · EXAMPLE OF EXCELLENT WORK' : ''}`,
      source.url ? `Link: ${source.url}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const parts: string[] = [header]
    for (const p of ps) {
      if (budget <= 0) break
      const text = p.content.length > budget ? p.content.slice(0, budget) : p.content
      parts.push(`--- passage${p.heading ? ` (section: ${p.heading})` : ''} ---\n${text}`)
      budget -= text.length
    }
    if (parts.length === 1 && budget <= 0) break
    sources.push(source)
    blocks.push(parts.join('\n'))
  }

  return {
    sources,
    contextBlock: blocks.join('\n\n'),
    versionIds: sources.map((s) => s.version_id),
  }
}

// Which [S#] refs an answer actually cites ("[S1]", "[S2, S4]", "[S1][S3]").
export function citedRefs(answer: string): Set<number> {
  const refs = new Set<number>()
  for (const m of answer.matchAll(/\[(S\d+(?:\s*,\s*S?\d+)*)\]/g)) {
    for (const n of m[1].match(/\d+/g) || []) refs.add(Number(n))
  }
  return refs
}
