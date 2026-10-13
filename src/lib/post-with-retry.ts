// A POST that creates something valuable, hardened for the two ways such
// requests have actually failed in the field (14 Sep 2026): a request that
// hangs until the browser gives up (Safari: "Load failed") and a transient 503
// from the server when Supabase Auth didn't answer. Each attempt is capped at
// 30s, and a transport failure or a retryable status is retried ONCE after a
// short pause — a retry opens a fresh connection, which is what a page reload
// was doing for the user by hand. Callers' routes must make a retry safe
// (dedupe), since a request that did land may be sent twice.
//
// Shared by the Sales Coach submission form (POST /api/sales-coach) and the
// Re-evaluate button (POST /api/sales-coach/[id]/reevaluate).
export async function postWithRetry(url: string, body: string): Promise<{ id?: string; error?: string }> {
  const ATTEMPT_TIMEOUT_MS = 30_000
  let lastError = 'Could not submit. Please try again.'
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500))
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      })
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string; retryable?: boolean }
      const transient = res.status === 503 || res.status === 502 || res.status === 504 || res.status === 429 || data.retryable === true
      if (res.ok && data.id) return data
      if (!transient) return { error: data.error || `Request failed (${res.status})` }
      lastError = data.error || 'The server is busy. Please try again.'
    } catch (err) {
      // AbortError (our timeout) or TypeError (network: "Load failed" /
      // "Failed to fetch") — both worth exactly one more try.
      lastError = err instanceof Error && err.name === 'AbortError'
        ? 'The request timed out. Please check your connection and try again.'
        : 'Connection interrupted. Please try again.'
    } finally {
      clearTimeout(timer)
    }
  }
  return { error: lastError }
}
