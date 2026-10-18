import type { CiProfile, CiVerdict } from './types'

// The commercial qualification rules (TRC system prompt section 7 + the
// project's headquarters rule), applied IN CODE. The model's own "Qualified"
// label is never trusted on its own: in the manual Poland run it labelled 20
// companies with USD 5–56M revenue as "Qualified"/"Likely qualified".
//
// verified revenue ≥ threshold                → Qualified
// revenue unconfirmed / unpublished, or two searched figures disagreeing >2.5x,
//   with strong scale indicators (§7.2)       → Likely qualified
// revenue between USD 1M and the threshold, a foreign parent (when the
//   project requires local ownership), or liquidation → Outside criteria

export function parseAmount(str: string | null | undefined): { v: number; mult: number | null } | null {
  if (str == null) return null
  const s = String(str).replace(/\(.*?\)/g, ' ')
  const m = s.match(/(\d[\d\s .,]*\d|\d)\s*(billion|bn|mld|million|mln|mn|m|thousand|tys|k)?(?![a-z])/i)
  if (!m) return null
  let n = m[1].replace(/[\s ]/g, '')
  if (n.includes(',') && n.includes('.')) n = n.replace(/,/g, '')
  else if (/^\d{1,3}(,\d{3})+$/.test(n)) n = n.replace(/,/g, '')
  else n = n.replace(',', '.')
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  const u = (m[2] || '').toLowerCase()
  return { v, mult: /^(billion|bn|mld)$/.test(u) ? 1e9 : /^(million|mln|mn|m)$/.test(u) ? 1e6 : /^(thousand|tys|k)$/.test(u) ? 1e3 : null }
}

// Fallback rates (local units per USD) only for when the reply gives no USD equivalent.
const PER_USD: Record<string, number> = { USD: 1, EUR: 0.93, GBP: 0.79, PLN: 3.9, CHF: 0.88, CZK: 23, HUF: 360, RON: 4.6, SEK: 10.5, NOK: 10.8, DKK: 6.9, TRY: 34, AED: 3.67, SAR: 3.75, QAR: 3.64, INR: 88, NGN: 1500, KES: 129, ZAR: 18, EGP: 48, MAD: 9.9, JPY: 150, CNY: 7.2, KRW: 1380, IDR: 16000, MYR: 4.5, THB: 35, PHP: 57, VND: 25000, BRL: 5.5, MXN: 18.5, CLP: 940, COP: 4100, PEN: 3.7, ARS: 1000, TTD: 6.8, JMD: 157, KZT: 480, UZS: 12600, AZN: 1.7, GEL: 2.7, UAH: 41 }

export function usdRevenue(r: CiProfile['revenue']): number | null {
  if (!r) return null
  // Prefer the USD equivalent the reply states.
  const u = parseAmount(r.usd)
  const a = parseAmount(r.amount)
  if (!a && !u) return null
  const cur = String(r.currency || '')
  const curMult = /billion|bn|mld/i.test(cur) ? 1e9 : /million|mln|mn|\bm\b/i.test(cur) ? 1e6 : null
  const mult = a ? a.mult || curMult || (a.v < 1000 ? 1e6 : 1) : 1
  if (u && (/usd|\$/i.test(String(r.usd)) || !a)) return u.v * (u.mult || (u.v < 1e5 && mult >= 1e6 ? mult : 1))
  if (!a) return null
  const code = ((cur + ' ' + r.amount).match(/\b[A-Z]{3}\b/) || ['USD'])[0].toUpperCase()
  const rate = PER_USD[code]
  if (!rate) return u ? u.v * (u.mult || 1) : null
  return (a.v * mult) / rate
}

export function assess(p: CiProfile | null, opts: { minRevenueUsd: number; localHqOnly: boolean; altRevenueUsdMillion?: number | null }): CiVerdict {
  if (!p) return { pass: false, label: 'Outside criteria', reason: 'Not profiled' }
  if (opts.localHqOnly && (!p.hq_in_country || p.foreign_parent)) return { pass: false, label: 'Outside criteria', reason: `Ultimate parent or headquarters outside the country (${p.foreign_parent || 'foreign-owned'})` }
  if (/liquidat|likwidac|bankrupt|insolven|upad/i.test(`${p.name} ${p.qualification_basis}`)) return { pass: false, label: 'Outside criteria', reason: 'In liquidation / insolvency' }
  const T = opts.minRevenueUsd
  const M = (n: number) => `USD ${Math.round(n / 1e6)}M`
  let usd = usdRevenue(p.revenue)
  const alt = opts.altRevenueUsdMillion ? opts.altRevenueUsdMillion * 1e6 : null
  const indicators = (p.scale_indicators || []).filter((x) => x && !/^n\/?a$/i.test(x.trim())).length
  const bigCapital = /(\d[\d.,]*)\s*(billion|bn|mld)/i.test(`${(p.scale_indicators || []).join(' ')} ${p.qualification_basis}`)
  const modelSaysScale = /^(qualified|likely qualified)$/i.test(p.model_qualification.trim())
  const conflict = usd != null && alt != null && (usd / alt > 2.5 || alt / usd > 2.5)
  if (conflict && Math.min(usd!, alt!) < T) {
    return bigCapital || indicators >= 2
      ? { pass: true, label: 'Likely qualified', conflict: true, revenue_usd: usd, reason: `Revenue figures differ between sources (≈ ${M(usd!)} vs ≈ ${M(alt!)}); qualified on scale indicators (section 7.2)` }
      : { pass: false, label: 'Outside criteria', conflict: true, revenue_usd: usd, reason: 'Revenue figures differ between sources and the scale evidence is thin' }
  }
  if (conflict) return { pass: true, label: 'Likely qualified', conflict: true, revenue_usd: usd, reason: `Revenue above ${M(T)} on both figures, but the sources differ (≈ ${M(usd!)} vs ≈ ${M(alt!)}) — treat the exact figure as unverified` }
  if (usd != null && usd >= T) {
    return p.revenue?.status === 'Unverified'
      ? { pass: true, label: 'Likely qualified', revenue_usd: usd, reason: `Reported revenue ≈ ${M(usd)} (not confirmed by a primary source)` }
      : { pass: true, label: 'Qualified', revenue_usd: usd, reason: `Revenue ≈ ${M(usd)} — above the ${M(T)} threshold` }
  }
  if (usd != null && usd >= 1e6) return { pass: false, label: 'Outside criteria', revenue_usd: usd, reason: `Revenue ≈ ${M(usd)} — below the ${M(T)} threshold` }
  // No meaningful revenue figure (unpublished, or a pre-revenue project company): §7.2 scale indicators decide.
  if (modelSaysScale && (bigCapital || indicators >= 2)) return { pass: true, label: 'Likely qualified', revenue_usd: usd, reason: 'Revenue unverified; qualified on scale indicators (section 7.2)' }
  return { pass: false, label: 'Outside criteria', revenue_usd: usd, reason: 'Scale uncertain — no revenue figure and not enough scale evidence' }
}
