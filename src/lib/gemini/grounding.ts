// Turning a Google-Search-grounded Gemini reply into real source links.
// Shared by the Interview Letter research (interview-letter-research.ts) and
// the Interview Tool's Gemini web research (research-engine.ts).
import type { GeminiResult } from '@/lib/country-intel/gemini'

export interface SourceLink {
  title: string
  url: string
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim())
}

const squash = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

const REDIRECT_RE = /vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/

// Google returns its result pages as short-lived vertexaisearch redirect
// links; following one (without downloading the page) gives the real URL,
// which is what gets stored. On any failure the redirect link is kept.
async function resolveRedirect(uri: string, timeoutMs: number): Promise<string> {
  if (!REDIRECT_RE.test(uri)) return uri
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(uri, { redirect: 'manual', signal: ctrl.signal, cache: 'no-store' })
    return r.headers.get('location') || uri
  } catch {
    return uri
  } finally {
    clearTimeout(t)
  }
}

// The search results behind each line, from the grounding supports whose
// text overlaps it (empty for a line no search result backs).
//
// keepUnresolved: false drops a link whose redirect couldn't be resolved
// instead of keeping the redirect. Use it for anything stored and read later,
// such as Interview Tool research: the redirect links stop working.
export async function groundingLinks(
  lines: string[],
  r: Pick<GeminiResult, 'supports' | 'chunks'>,
  opts: { keepUnresolved?: boolean } = {},
): Promise<SourceLink[][]> {
  const keepUnresolved = opts.keepUnresolved ?? true
  const supports = r.supports
    .map((s) => ({ t: squash(s.text), idx: s.idx }))
    .filter((s) => s.t.length >= 12)

  const picks = lines.map((item) => {
    const it = squash(item)
    const idx = new Set<number>()
    for (const s of supports) {
      if (it.includes(s.t.slice(0, 60)) || s.t.includes(it.slice(0, 60))) s.idx.forEach((i) => idx.add(i))
    }
    return [...idx].slice(0, 4)
  })

  const used = [...new Set(picks.flat())]
  const resolved = new Map<number, SourceLink>()
  await Promise.all(
    used.map(async (i) => {
      const c = r.chunks[i]
      if (!c?.uri) return
      const url = await resolveRedirect(c.uri, 4000)
      if (!keepUnresolved && REDIRECT_RE.test(url)) return
      let title = c.title
      if (!title) {
        try { title = new URL(url).hostname.replace(/^www\./, '') } catch { title = 'source' }
      }
      resolved.set(i, { title, url })
    }),
  )

  return picks.map((idx) => {
    const links: SourceLink[] = []
    for (const i of idx) {
      const l = resolved.get(i)
      if (l && !links.some((x) => x.url === l.url)) links.push(l)
    }
    return links
  })
}
