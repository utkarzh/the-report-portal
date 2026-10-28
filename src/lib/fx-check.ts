// Exchange-rate sanity check against the market (client review, 26 Oct
// 2026). Jamaica's project rate was entered as 0.0063 — USD per JMD — where
// Cash Box means JMD per USD (~158.77), so a 40,000 JMD taxi became $6.3M,
// and the old check (each ticket against the project's own rate) waved all
// 21 such tickets through. A rate here is always "quote units per 1 base
// unit"; callers say which currency is which. The result is only ever a
// warning or a flag — the rate the person typed is kept (brief rule #4: the
// director's chosen rate is never overridden). Pure, so both the forms and
// the API routes use the same verdict.

export const RATE_OFF_TOLERANCE = 0.15

export type RateVerdict = 'ok' | 'off' | 'inverted'

export function checkRate(entered: number, market: number): { verdict: RateVerdict; deviation: number } {
  if (!(entered > 0) || !(market > 0)) return { verdict: 'ok', deviation: 0 }
  const deviation = Math.abs(entered - market) / market
  if (deviation <= RATE_OFF_TOLERANCE) return { verdict: 'ok', deviation }
  // 1/entered close to the market = the rate was typed the other way round.
  const inverseDeviation = Math.abs(1 / entered - market) / market
  return { verdict: inverseDeviation <= RATE_OFF_TOLERANCE ? 'inverted' : 'off', deviation }
}

// A rate 10× or more off in either direction is never a rounding or
// exchange-bureau difference — it's a wrong rate (a USD receipt entered at
// 158.77 instead of 1 comes out 159× too small).
export const GROSS_RATE_FACTOR = 10

export function isGrossRateError(entered: number, market: number): boolean {
  if (!(entered > 0) || !(market > 0)) return false
  const ratio = entered / market
  return ratio >= GROSS_RATE_FACTOR || ratio <= 1 / GROSS_RATE_FACTOR
}

// "24% higher", "72% lower", "about 159× lower" — how far a rate is from the
// reference, in words a reviewer reads at a glance.
export function rateGap(entered: number, market: number): string {
  const ratio = entered / market
  const times = (x: number) => (x < 10 ? Math.round(x * 10) / 10 : Math.round(x))
  if (ratio >= 2) return `about ${times(ratio)}× higher`
  if (ratio <= 0.5) return `about ${times(1 / ratio)}× lower`
  return `${Math.round(Math.abs(ratio - 1) * 100)}% ${ratio > 1 ? 'higher' : 'lower'}`
}

// "158.84", "0.8921", "1,334.3" — enough digits to compare by eye.
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return '—'
  const digits = rate >= 100 ? 2 : rate >= 1 ? 4 : 6
  return rate.toLocaleString('en-US', { maximumFractionDigits: digits })
}
