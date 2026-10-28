// Today's market exchange rate, for the sanity check in fx-check.ts. Two
// free, keyless daily sources (both cover every currency Cash Box has used —
// checked 26 Oct 2026: JMD, INR, NGN, KZT, JPY, EUR…), the second only when
// the first fails. Cached for 12 hours, per process and in Next's fetch
// cache. Never throws: when neither answers, callers get null and simply skip
// the market comparison — a missing reference must never block logging.

export interface MarketRate {
  // quote units per 1 base unit
  rate: number
  source: string
  sourceUrl: string
  asOf: string
}

const CACHE_MS = 12 * 60 * 60 * 1000
const TIMEOUT_MS = 4000
const cache = new Map<string, { at: number; rates: Record<string, number>; source: string; sourceUrl: string; asOf: string }>()

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { next: { revalidate: CACHE_MS / 1000 }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function ratesFor(base: string) {
  const hit = cache.get(base)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit

  try {
    const d = await getJson(`https://open.er-api.com/v6/latest/${base}`) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string }
    if (d?.result === 'success' && d.rates) {
      const entry = { at: Date.now(), rates: d.rates, source: 'ExchangeRate-API', sourceUrl: 'https://www.exchangerate-api.com', asOf: d.time_last_update_utc ?? '' }
      cache.set(base, entry)
      return entry
    }
  } catch { /* try the fallback */ }

  try {
    const key = base.toLowerCase()
    const d = await getJson(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${key}.json`) as Record<string, unknown> & { date?: string }
    const raw = d?.[key] as Record<string, number> | undefined
    if (raw) {
      const rates = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toUpperCase(), v]))
      const entry = { at: Date.now(), rates, source: 'currency-api', sourceUrl: 'https://github.com/fawazahmed0/exchange-api', asOf: d.date ?? '' }
      cache.set(base, entry)
      return entry
    }
  } catch { /* no reference today */ }

  return null
}

export async function marketRate(base: string, quote: string): Promise<MarketRate | null> {
  const b = base.trim().toUpperCase()
  const q = quote.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(b) || !/^[A-Z]{3}$/.test(q)) return null
  if (b === q) return { rate: 1, source: 'same currency', sourceUrl: '', asOf: '' }
  const entry = await ratesFor(b)
  const rate = entry?.rates[q]
  if (!entry || typeof rate !== 'number' || !(rate > 0)) return null
  return { rate, source: entry.source, sourceUrl: entry.sourceUrl, asOf: entry.asOf }
}
