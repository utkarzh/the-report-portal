// Browser side of starting a live voice call fast. Preparing a call (our
// server loads the five TRC documents, the card, the transcript and the chat,
// then OpenAI accepts the ~46k-token prompt and returns a client secret) took
// 4-5 s, all before the browser could even start connecting. So the Coaching
// tab prepares one in the background (prefetchVoiceSecret) and "Talk live"
// takes it (takeVoiceSecret), leaving only the ~2 s WebRTC connection. A
// secret lives 120 s (VOICE_SECRET_TTL_SECONDS); one older than FRESH_MS is
// never used. Minting has no AI cost: nothing is billed until the call talks.

export interface VoiceSecret {
  clientSecret: string
  maxSeconds: number
}

// A secret is fetched once it's asked for, so "fresh" counts from the request.
const FRESH_MS = 85_000

type Entry = { at: number; promise: Promise<VoiceSecret> }
const cache = new Map<string, Entry>()

// An error the call screen shouldn't retry (out of budget, no access, no card).
export class VoiceSecretError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message) }
}

async function fetchSecret(negotiationId: string): Promise<VoiceSecret> {
  let res: Response
  try {
    res = await fetch(`/api/sales-coach/${negotiationId}/voice-session`, { method: 'POST', signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new VoiceSecretError("Couldn't reach the server. Check your connection and try again.", true)
  }
  const body = await res.json().catch(() => ({})) as { clientSecret?: string; maxSeconds?: number; error?: string }
  if (!res.ok || !body.clientSecret) {
    const retryable = res.status >= 500 || res.status === 429 || res.status === 0
    throw new VoiceSecretError(body.error || 'The coach could not join the call. Please try again.', retryable)
  }
  return { clientSecret: body.clientSecret, maxSeconds: body.maxSeconds || 15 * 60 }
}

// Prepares a call in the background, unless one is already fresh.
export function prefetchVoiceSecret(negotiationId: string): void {
  const entry = cache.get(negotiationId)
  if (entry && Date.now() - entry.at < FRESH_MS) return
  const promise = fetchSecret(negotiationId)
  promise.catch(() => { if (cache.get(negotiationId)?.promise === promise) cache.delete(negotiationId) })
  cache.set(negotiationId, { at: Date.now(), promise })
}

// The prepared secret if it's still fresh, otherwise a new one (shared with any
// other attempt asking at the same moment, such as React's double start in
// development). It stays cached until the call has connected with it
// (forgetVoiceSecret): its prompt holds the chat as it was when prepared, so
// the next call needs a new one.
export async function takeVoiceSecret(negotiationId: string): Promise<VoiceSecret> {
  const entry = cache.get(negotiationId)
  if (entry && Date.now() - entry.at < FRESH_MS) {
    try { return await entry.promise } catch { cache.delete(negotiationId) }
  }
  const promise = fetchSecret(negotiationId)
  promise.catch(() => { if (cache.get(negotiationId)?.promise === promise) cache.delete(negotiationId) })
  cache.set(negotiationId, { at: Date.now(), promise })
  return promise
}

// The chat changed (a typed turn, or a call ended), so a prepared prompt is out
// of date.
export function forgetVoiceSecret(negotiationId: string): void {
  cache.delete(negotiationId)
}
