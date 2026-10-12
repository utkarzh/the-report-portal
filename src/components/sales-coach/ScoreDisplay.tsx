import { scoreBand, type ScoreBandTone } from '@/lib/sales-coach'

// Shared Execution Score visuals for the Sales Coach module: the score is a
// percentage for everyone, always paired with its plain-language band so the
// number is never the whole message. No hooks — usable from server components
// (the negotiations list) as well as client ones.

export const BAND_TONE: Record<ScoreBandTone, { ring: string; text: string; dot: string; soft: string }> = {
  strong: { ring: '#059669', text: 'text-emerald-700', dot: 'bg-emerald-500', soft: 'bg-emerald-50 ring-emerald-200' },
  solid: { ring: '#d97706', text: 'text-amber-700', dot: 'bg-amber-500', soft: 'bg-amber-50 ring-amber-200' },
  growth: { ring: '#dc2626', text: 'text-red-700', dot: 'bg-red-500', soft: 'bg-red-50 ring-red-200' },
}

// Compact "● 79%" pill for lists, tables and headers. `withLabel` adds the
// band's short name ("● 79% · Good").
export function ScorePill({ pct, withLabel = false, dark = false }: { pct: number | null; withLabel?: boolean; dark?: boolean }) {
  const band = scoreBand(pct)
  if (pct === null || !band) return null
  const tone = BAND_TONE[band.tone]
  return (
    <span
      title={band.label}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        dark ? 'bg-black text-white' : `ring-1 ${tone.soft} ${tone.text}`
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {pct}%
      {withLabel && <span className={`font-normal ${dark ? 'text-white/60' : 'opacity-80'}`}>· {band.short}</span>}
    </span>
  )
}

// The Report Card's headline ring.
export function ScoreRing({ pct, size = 116 }: { pct: number | null; size?: number }) {
  const band = scoreBand(pct)
  const stroke = 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const filled = pct === null ? 0 : Math.max(0, Math.min(100, pct)) / 100
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ebe8e2" strokeWidth={stroke} />
        {band && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={BAND_TONE[band.tone].ring}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * filled} ${c}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums tracking-tight text-gray-900">
          {pct === null ? '—' : pct}
          {pct !== null && <span className="text-base font-medium text-gray-400">%</span>}
        </span>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-gray-400">Execution</span>
      </div>
    </div>
  )
}
