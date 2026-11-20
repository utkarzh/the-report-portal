'use client'

// Browser-side calls shared by the Guardian's content list: the collapsed
// row's Publish button and the open row's editor run exactly the same steps.

export async function kbApi<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong')
  return data as T
}

// Publishing is resumable: a large document is indexed across several calls,
// each returning { done: false, embedded, total } until it is finished.
export async function publishKnowledgeItem(itemId: string, onProgress?: (text: string) => void): Promise<void> {
  for (let round = 0; round < 40; round++) {
    const data = await kbApi<{ done?: boolean; embedded?: number; total?: number }>(`/api/knowledge/items/${itemId}/publish`, 'POST')
    if (data.done) return
    onProgress?.(`Indexing… ${data.embedded ?? 0} of ${data.total ?? '?'} passages`)
  }
  throw new Error('Indexing is taking unusually long — click Publish again to continue.')
}
