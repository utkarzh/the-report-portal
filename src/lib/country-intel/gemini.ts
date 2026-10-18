// Gemini with Google Search grounding, for the Country Intelligence module.
//
// Hard-won rules from the manual Poland run (13 Oct 2026) — keep them:
//  • Grounding is model-optional on Gemini 3: a reply can come back with NO
//    search at all, written from memory — and those replies were verified to be
//    fabricated (deep links 404, claimed CEOs/figures absent from the pages).
//    Every caller must reject a reply whose `queries` is empty.
//  • Replies are streamed. With the plain labelled-line / pipe-line prompts this
//    module uses, a reply that skipped search reports a running
//    candidatesTokenCount on its first text chunk while a grounded one does not,
//    so it is cut off there (≈ $0.005 instead of a full reply) and retried.
//  • Grounded replies sometimes omit candidatesTokenCount: cost is then
//    estimated from the text length so the budget stays honest.
//  • A dropped connection may still be billed: callers book `lostCallCost`.

export interface ModelPrice { in: number; out: number }

// Paid-tier USD per 1M tokens (prompts ≤ 200k). Output covers thinking tokens.
// Gemini 3.8 Flash doubles on 1 Jan 2027 ($1.50 / $7.50) per Google's price list.
export function priceFor(model: string, now = new Date()): ModelPrice {
  const y2027 = now >= new Date('2027-01-01T00:00:00Z')
  if (model.startsWith('gemini-3.1-pro')) return { in: 2.0, out: 12.0 }
  if (model.startsWith('gemini-3.8-flash') || model.startsWith('gemini-3.6-flash')) return y2027 ? { in: 1.5, out: 7.5 } : { in: 0.75, out: 3.75 }
  if (model.startsWith('gemini-3.5-flash-lite')) return { in: 0.3, out: 2.5 }
  if (model.startsWith('gemini-3.1-flash-lite')) return { in: 0.25, out: 1.5 }
  return { in: 2.0, out: 12.0 } // unknown model: assume the expensive end
}

// Google Search on Gemini 3: 5,000 free queries a month (shared across the
// account), then $14 per 1,000. Set CI_BILL_SEARCHES=1 once past the free tier.
const SEARCH_COST = process.env.CI_BILL_SEARCHES === '1' ? 0.014 : 0

export interface GeminiUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  toolUsePromptTokenCount?: number
  totalTokenCount?: number
}

interface GroundingMeta {
  webSearchQueries?: string[]
  groundingChunks?: { web?: { uri?: string; title?: string } }[]
  groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[]
}

export interface GeminiResult {
  text: string
  aborted: boolean          // cut off at the first chunk because it skipped search
  finishReason: string | null
  usage: GeminiUsage
  costUsd: number
  queries: string[]
  chunks: { title: string; uri: string }[]
  supports: { text: string; idx: number[] }[]
  model: string
}

export class GeminiError extends Error {
  constructor(message: string, public code: number, public billedUsd = 0, public retryable = false) {
    super(message)
  }
}

export function costOf(model: string, u: GeminiUsage, textChars: number, searches = 0): number {
  const p = priceFor(model)
  const input = (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0)
  const cand = u.candidatesTokenCount ?? Math.ceil(textChars / 3)
  const output = cand + (u.thoughtsTokenCount || 0)
  return (input * p.in + output * p.out) / 1e6 + searches * SEARCH_COST
}

export function worstCaseCost(model: string, maxOutputTokens: number): number {
  const p = priceFor(model)
  return (8000 * p.in + maxOutputTokens * p.out) / 1e6
}

export function lostCallCost(model: string, maxOutputTokens: number): number {
  const p = priceFor(model)
  return (8000 * p.in + Math.min(maxOutputTokens, 11000) * p.out) / 1e6
}

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY
  if (!k) throw new GeminiError('GEMINI_API_KEY is not configured', 500)
  return k.trim()
}

export async function callGemini(opts: {
  model: string
  system: string
  user: string
  maxOutputTokens: number
  grounded?: boolean
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
  earlyAbort?: boolean
  timeoutMs: number
}): Promise<GeminiResult> {
  const grounded = opts.grounded ?? true
  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig: { maxOutputTokens: opts.maxOutputTokens, thinkingConfig: { thinkingLevel: opts.thinkingLevel || 'low' } },
    ...(grounded ? { tools: [{ google_search: {} }] } : {}),
  }
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs)
  let text = ''
  let usage: GeminiUsage = {}
  let gm = null as GroundingMeta | null
  let finish: string | null = null
  let aborted = false
  try {
    const res = await fetch(`${base}:${grounded ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
      method: 'POST',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => null) as { error?: { message?: string } } | { error?: { message?: string } }[] | null
      const err = Array.isArray(j) ? j[0]?.error : j?.error
      const msg = err?.message || res.statusText
      const retryable = [429, 500, 502, 503, 504].includes(res.status) && !/billing|credit|prepay|limit: 0/i.test(msg)
      throw new GeminiError(`Gemini ${res.status}: ${msg}`, res.status, 0, retryable)
    }
    if (!grounded) {
      const j = await res.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; usageMetadata?: GeminiUsage }
      const c = j.candidates?.[0]
      text = (c?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('')
      usage = j.usageMetadata || {}
      finish = c?.finishReason || null
    } else {
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      outer: for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, '\n')
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).replace(/^data: /, '')
          buf = buf.slice(i + 2)
          let d: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string; groundingMetadata?: GroundingMeta }[]; usageMetadata?: GeminiUsage; error?: { message?: string; code?: number } }
          try { d = JSON.parse(line) } catch { continue }
          if (d.error) throw new GeminiError(`Gemini stream error: ${d.error.message}`, d.error.code || 500, 0, true)
          const c = d.candidates?.[0]
          if (d.usageMetadata) usage = d.usageMetadata
          if (c?.groundingMetadata) gm = c.groundingMetadata
          if (c?.finishReason) finish = c.finishReason
          const tx = (c?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('')
          if (!tx) continue
          const first = text.length === 0
          text += tx
          if (first && opts.earlyAbort && !gm && typeof d.usageMetadata?.candidatesTokenCount === 'number') {
            aborted = true
            ctrl.abort()
            await reader.cancel().catch(() => {})
            break outer
          }
        }
      }
    }
  } catch (e) {
    if (!aborted) {
      if (e instanceof GeminiError) throw e
      const timedOut = ctrl.signal.aborted
      throw new GeminiError(timedOut ? 'Gemini call timed out' : `Gemini connection failed: ${String(e)}`, 0, lostCallCost(opts.model, opts.maxOutputTokens), true)
    }
  } finally {
    clearTimeout(timer)
  }
  const queries = gm?.webSearchQueries || []
  const costUsd = aborted
    ? ((usage.promptTokenCount || 4500) * priceFor(opts.model).in + ((usage.thoughtsTokenCount || 0) + (usage.candidatesTokenCount || 0) + 600) * priceFor(opts.model).out) / 1e6
    : costOf(opts.model, usage, text.length, queries.length)
  return {
    text: aborted ? '' : text,
    aborted,
    finishReason: aborted ? 'ABORTED_UNGROUNDED' : finish,
    usage,
    costUsd,
    queries,
    chunks: (gm?.groundingChunks || []).map((c) => ({ title: c.web?.title || '', uri: c.web?.uri || '' })).filter((c) => c.uri),
    supports: (gm?.groundingSupports || []).map((s) => ({ text: s.segment?.text || '', idx: s.groundingChunkIndices || [] })),
    model: opts.model,
  }
}

// Pull a JSON object out of a model reply (fenced or bare), with light repair.
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const s = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  for (const a of [s, s.replace(/,\s*([}\]])/g, '$1'), s.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')]) {
    try { return JSON.parse(a) as T } catch { /* try next */ }
  }
  return null
}
