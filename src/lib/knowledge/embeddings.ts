import { getOpenAIClient } from '@/lib/openai/client'

// Semantic half of Knowledge Base search. Optional by design: with no
// OPENAI_API_KEY the module still works on Postgres full-text search alone
// (knowledge_search() skips the semantic branch when no query vector is
// passed), it just matches on words rather than meaning.

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536
// text-embedding-3-small list price, per 1M input tokens.
export const EMBEDDING_PRICE_PER_MILLION = 0.02
const BATCH_SIZE = 96

export function embeddingsEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY
}

export function embeddingCost(tokens: number): number {
  return (tokens / 1_000_000) * EMBEDDING_PRICE_PER_MILLION
}

export interface EmbeddingResult {
  vectors: number[][]
  tokens: number
}

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  const vectors: number[][] = []
  let tokens = 0
  const client = getOpenAIClient()
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, 24_000))
    const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: batch })
    const sorted = [...res.data].sort((a, b) => a.index - b.index)
    for (const d of sorted) vectors.push(d.embedding)
    tokens += res.usage?.total_tokens ?? 0
  }
  return { vectors, tokens }
}

// The text a passage is embedded as: item title + heading path give a passage
// from deep inside a long document the context it needs to match a question.
export function passageEmbeddingInput(title: string, heading: string, content: string): string {
  return [title, heading, content].filter((s) => s && s.trim()).join('\n')
}
