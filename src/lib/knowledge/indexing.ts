import { supabaseAdmin } from '@/lib/supabase/admin'
import { logUsageEvent } from '@/lib/claude/usage'
import { chunkText, linkChunk, type TextChunk } from '@/lib/knowledge/chunking'
import {
  EMBEDDING_MODEL,
  embedTexts,
  embeddingCost,
  embeddingsEnabled,
  passageEmbeddingInput,
} from '@/lib/knowledge/embeddings'
import type { KnowledgeItem, KnowledgeItemVersion } from '@/types'

// Indexing pipeline (US-106, US-123). Runs when the Guardian clicks Publish,
// BEFORE the item's published pointer is flipped — so the version being
// indexed is never searchable until it is complete, and the old version stays
// live until that single pointer update (never both at once, never neither).
//
// Resumable in slices: each call works until `deadlineAt`, then returns
// { done: false } and the client calls again. Every step is idempotent —
// passages upsert on (version_id, chunk_index) and only passages still missing
// an embedding are embedded — so a retry or a double-click never duplicates.

const INSERT_BATCH = 400
const EMBED_SLICE = 96
const UPDATE_CONCURRENCY = 12

export function buildChunks(item: Pick<KnowledgeItem, 'type'>, version: KnowledgeItemVersion): TextChunk[] {
  if (item.type === 'video' || item.type === 'link') {
    return linkChunk(version.title, version.description, version.url)
  }
  const body = item.type === 'document' ? version.extracted_text || '' : version.content || ''
  const withDescription = version.description.trim() ? `${version.description.trim()}\n\n${body}` : body
  return chunkText(withDescription)
}

// Drafts are mutable: any edit to a draft's indexable content invalidates
// passages left by an earlier, interrupted publish attempt.
export async function resetVersionIndex(versionId: string): Promise<void> {
  await supabaseAdmin.from('knowledge_chunks').delete().eq('version_id', versionId)
  await supabaseAdmin
    .from('knowledge_item_versions')
    .update({ index_status: 'not_indexed', chunk_count: 0 })
    .eq('id', versionId)
}

export interface IndexProgress {
  done: boolean
  total: number
  embedded: number
}

export async function indexVersion(opts: {
  item: KnowledgeItem
  version: KnowledgeItemVersion
  userId: string
  deadlineAt: number
}): Promise<IndexProgress> {
  const { item, userId, deadlineAt } = opts
  let version = opts.version
  if (version.index_status === 'indexed') {
    return { done: true, total: version.chunk_count, embedded: version.chunk_count }
  }

  if (version.index_status === 'not_indexed') {
    const chunks = buildChunks(item, version)
    if (chunks.length === 0) throw new Error('There is no content to publish yet.')
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const rows = chunks.slice(i, i + INSERT_BATCH).map((c) => ({
        version_id: version.id,
        item_id: item.id,
        chunk_index: c.index,
        title: version.title,
        heading: c.heading,
        content: c.content,
      }))
      const { error } = await supabaseAdmin
        .from('knowledge_chunks')
        .upsert(rows, { onConflict: 'version_id,chunk_index', ignoreDuplicates: true })
      if (error) throw new Error(`Indexing failed: ${error.message}`)
    }
    // A shorter re-chunk than an earlier attempt must not leave stale tails.
    await supabaseAdmin.from('knowledge_chunks').delete().eq('version_id', version.id).gte('chunk_index', chunks.length)
    const { data: updated } = await supabaseAdmin
      .from('knowledge_item_versions')
      .update({ index_status: 'indexing', chunk_count: chunks.length })
      .eq('id', version.id)
      .select('*')
      .single()
    version = (updated as KnowledgeItemVersion) ?? { ...version, index_status: 'indexing', chunk_count: chunks.length }
  }

  const total = version.chunk_count

  // Full-text search needs nothing more (tsv is a generated column).
  if (!embeddingsEnabled()) {
    await supabaseAdmin.from('knowledge_item_versions').update({ index_status: 'indexed' }).eq('id', version.id)
    return { done: true, total, embedded: total }
  }

  let tokens = 0
  let done = false
  let failure: Error | null = null
  try {
    while (Date.now() < deadlineAt) {
      const { data: pending } = await supabaseAdmin
        .from('knowledge_chunks')
        .select('id, title, heading, content')
        .eq('version_id', version.id)
        .is('embedding', null)
        .order('chunk_index')
        .limit(EMBED_SLICE)
      if (!pending || pending.length === 0) {
        done = true
        break
      }
      const { vectors, tokens: used } = await embedTexts(
        pending.map((c) => passageEmbeddingInput(c.title, c.heading, c.content)),
      )
      tokens += used
      for (let i = 0; i < pending.length; i += UPDATE_CONCURRENCY) {
        await Promise.all(
          pending.slice(i, i + UPDATE_CONCURRENCY).map((c, j) =>
            supabaseAdmin
              .from('knowledge_chunks')
              .update({ embedding: JSON.stringify(vectors[i + j]) })
              .eq('id', c.id),
          ),
        )
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err))
  }

  if (tokens > 0 || failure) {
    await logUsageEvent({
      userId,
      workflow: 'knowledge_base_indexing',
      sourceId: version.id,
      model: EMBEDDING_MODEL,
      tokensInput: tokens,
      tokensTotal: tokens,
      costUsd: embeddingCost(tokens),
      status: failure ? 'error' : 'success',
      error: failure?.message ?? null,
    })
  }
  if (failure) throw new Error(`Indexing was interrupted (${failure.message}). Click Publish again to resume.`)

  if (done) {
    await supabaseAdmin.from('knowledge_item_versions').update({ index_status: 'indexed' }).eq('id', version.id)
    return { done: true, total, embedded: total }
  }
  const { count } = await supabaseAdmin
    .from('knowledge_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('version_id', version.id)
    .not('embedding', 'is', null)
  return { done: false, total, embedded: count ?? 0 }
}
