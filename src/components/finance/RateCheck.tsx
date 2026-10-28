'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { checkRate, formatRate, isGrossRateError, rateGap } from '@/lib/fx-check'

interface Market {
  rate: number | null
  source?: string
  sourceUrl?: string
}

// One request per currency pair per page load, shared by every field.
const marketCache = new Map<string, Promise<Market>>()

export function useMarketRate(base: string, quote: string): Market | null {
  const valid = /^[A-Z]{3}$/.test(base) && /^[A-Z]{3}$/.test(quote) && base !== quote
  const key = `${base}/${quote}`
  const [market, setMarket] = useState<Market | null>(null)
  useEffect(() => {
    if (!valid) { setMarket(null); return }
    let cancelled = false
    if (!marketCache.has(key)) {
      marketCache.set(key, fetch(`/api/finance/fx-rate?base=${base}&quote=${quote}`)
        .then(r => r.json())
        .catch(() => ({ rate: null })))
    }
    marketCache.get(key)!.then(m => { if (!cancelled) setMarket(m) })
    return () => { cancelled = true }
  }, [key, valid, base, quote])
  return valid ? market : null
}

interface Props {
  // The rate is "quote units per 1 base unit" — e.g. base USD, quote JMD for
  // a project / receipt rate; base EUR (sent), quote USD (settlement) for
  // funds or a transfer.
  base: string
  quote: string
  rate: string | number
  // Offered when the rate looks inverted or far off: puts the market rate in.
  onUseRate?: (rate: number) => void
}

// Under every exchange-rate field (client review, 26 Oct 2026): says in
// words what the number means, and compares it with today's market rate so
// an inverted or mistyped rate is caught before anything is converted. Only
// a warning — the rate typed is what gets saved.
export default function RateCheck({ base, quote, rate, onUseRate }: Props) {
  const b = base.trim().toUpperCase()
  const q = quote.trim().toUpperCase()
  const market = useMarketRate(b, q)
  const entered = typeof rate === 'number' ? rate : parseFloat(rate)
  if (!/^[A-Z]{3}$/.test(b) || !/^[A-Z]{3}$/.test(q)) return null

  const readback = entered > 0 ? `1 ${b} = ${formatRate(entered)} ${q}` : `Enter how many ${q} make 1 ${b}.`
  const verdict = market?.rate && entered > 0 ? checkRate(entered, market.rate) : null
  const marketText = market?.rate ? `1 ${b} ≈ ${formatRate(market.rate)} ${q}` : ''

  return (
    <div className="text-xs mt-1.5 flex flex-col gap-1">
      <div className="text-gray-500 tabular-nums">{readback}</div>
      {verdict?.verdict === 'ok' && (
        <div className="inline-flex items-center gap-1 text-emerald-700"><Check size={12} /> In line with today&apos;s market rate ({marketText}).</div>
      )}
      {verdict?.verdict === 'off' && (
        <div className={`flex items-start gap-1 ${isGrossRateError(entered, market!.rate!) ? 'text-red-700 font-medium' : 'text-amber-700'}`}>
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>
            {rateGap(entered, market!.rate!)} than today&apos;s market rate ({marketText}) — please check it.
            {onUseRate && <> <button type="button" onClick={() => onUseRate(market!.rate!)} className="underline font-medium">Use {formatRate(market!.rate!)}</button></>}
          </span>
        </div>
      )}
      {verdict?.verdict === 'inverted' && (
        <div className="flex items-start gap-1 text-red-700 font-medium">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>
            This looks the wrong way round: today {marketText}. Enter how many {q} make 1 {b}.
            {onUseRate && <> <button type="button" onClick={() => onUseRate(market!.rate!)} className="underline">Use {formatRate(market!.rate!)}</button></>}
          </span>
        </div>
      )}
      {market?.rate && market.sourceUrl && (
        <a href={market.sourceUrl} target="_blank" rel="noreferrer" className="text-[10.5px] text-gray-400 hover:underline">Market rates by {market.source}</a>
      )}
    </div>
  )
}
