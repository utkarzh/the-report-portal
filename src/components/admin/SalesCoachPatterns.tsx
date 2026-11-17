'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { marked } from 'marked'
import {
  Sparkles, Loader2, Copy, Check, History, ChevronDown, AlertCircle, ArrowUpRight, ArrowDownRight, Minus,
  CheckCircle2, AlertTriangle, XCircle, HelpCircle, MinusCircle, UsersRound, ExternalLink, FileDown,
} from 'lucide-react'
import {
  PATTERN_MAX_CARDS, PATTERN_SCOPES, cardsForScope, computePatternStats, scopeAvailable,
  type PatternAnalysisListItem, type PatternCardSummary, type PatternExecutiveOption, type PatternScope, type PatternStats,
} from '@/lib/sales-coach-patterns'
import { scoreBand } from '@/lib/sales-coach'
import { BAND_TONE, ScorePill } from '@/components/sales-coach/ScoreDisplay'
import { formatDayMonthYearTime } from '@/lib/date-format'
import type { SalesCoachOutcome } from '@/types'

marked.use({ gfm: true, breaks: false })

// Sales Coach pattern analysis: pick a Sales Executive and how many of their
// Report Cards, see a free snapshot computed in the browser (the same
// computePatternStats() the AI is given), then ask the AI to read the cards
// together. Saved analyses are listed per person (migration 045).

const CARD = 'rounded-2xl bg-white ring-1 ring-[#e6e2da] shadow-[0_1px_2px_rgba(28,25,23,0.04),0_14px_34px_-26px_rgba(28,25,23,0.28)]'
const KICKER = 'text-[10.5px] font-semibold uppercase tracking-[0.16em] text-stone-500'
const KICKER_GOLD = 'text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#8f6626]'
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8973f]/60 focus-visible:ring-offset-2'

const OUTCOMES: { key: SalesCoachOutcome; label: string; dot: string }[] = [
  { key: 'signed', label: 'Signed', dot: 'bg-emerald-500' },
  { key: 'retorno', label: 'Follow-up (retorno)', dot: 'bg-sky-500' },
  { key: 'lost', label: 'Lost', dot: 'bg-rose-500' },
  { key: 'uncertain', label: 'Uncertain', dot: 'bg-stone-400' },
]

// Verdict colours are status colours, always shown with an icon and a label
// (the Report Card's scheme), never colour alone.
const VERDICT_SEGMENTS: { key: 'pass' | 'warn' | 'fail' | 'uv' | 'na'; label: string; bar: string; icon: React.ReactNode }[] = [
  { key: 'pass', label: 'Strong', bar: 'bg-emerald-500', icon: <CheckCircle2 size={12} className="text-emerald-600" /> },
  { key: 'warn', label: 'Partial', bar: 'bg-amber-400', icon: <AlertTriangle size={12} className="text-amber-600" /> },
  { key: 'fail', label: 'Weak', bar: 'bg-rose-500', icon: <XCircle size={12} className="text-rose-600" /> },
  { key: 'uv', label: 'UV (not verifiable)', bar: 'bg-sky-400', icon: <HelpCircle size={12} className="text-sky-600" /> },
  { key: 'na', label: 'N/A', bar: 'bg-stone-300', icon: <MinusCircle size={12} className="text-stone-500" /> },
]

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const period = (a: string | null, b: string | null) => (a && b ? (a.slice(0, 10) === b.slice(0, 10) ? longDate(a) : `${shortDate(a)} – ${longDate(b)}`) : '—')

interface SavedAnalysis {
  id: string
  scope: string
  card_count: number
  period_start: string | null
  period_end: string | null
  output: string
  created_by_name: string | null
  created_at: string
}

type Run =
  | { status: 'idle' }
  | { status: 'running'; text: string; count: number; startedAt: number }
  | { status: 'done'; text: string; count: number; scope: PatternScope; periodStart: string | null; periodEnd: string | null; saved: boolean; createdAt: string | null; analysisId: string | null }
  | { status: 'error'; message: string }

export default function SalesCoachPatterns({ executives, initialUserId, canDownloadPdf = false }: { executives: PatternExecutiveOption[]; initialUserId: string | null; canDownloadPdf?: boolean }) {
  const [userId, setUserId] = useState<string | null>(initialUserId)
  const [scope, setScope] = useState<PatternScope>('10')
  const [cards, setCards] = useState<PatternCardSummary[] | null>(null)
  const [analyses, setAnalyses] = useState<PatternAnalysisListItem[]>([])
  const [historyAvailable, setHistoryAvailable] = useState(true)
  const [loadingCards, setLoadingCards] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [run, setRun] = useState<Run>({ status: 'idle' })
  const [viewing, setViewing] = useState<SavedAnalysis | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const analysisRef = useRef<HTMLDivElement>(null)

  const executive = executives.find((e) => e.id === userId) || null
  const firstName = executive?.name.split(/\s+/)[0] || ''
  const running = run.status === 'running'

  // One executive at a time: load their cards and saved analyses.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoadingCards(true)
    setLoadError(null)
    setCards(null)
    setRun({ status: 'idle' })
    setViewing(null)
    try { window.history.replaceState(null, '', `?user=${userId}`) } catch {}
    fetch(`/api/sales-coach/patterns?userId=${userId}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Could not load the Report Cards.')
        return body as { cards: PatternCardSummary[]; analyses: PatternAnalysisListItem[]; historyAvailable: boolean }
      })
      .then((body) => {
        if (cancelled) return
        setCards(body.cards)
        setAnalyses(body.analyses)
        setHistoryAvailable(body.historyAvailable)
        const n = body.cards.length
        setScope(n >= 10 ? '10' : n >= 5 ? '5' : 'all')
      })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load the Report Cards.') })
      .finally(() => { if (!cancelled) setLoadingCards(false) })
    return () => { cancelled = true }
  }, [userId])

  const selected = useMemo(() => (cards ? cardsForScope(cards, scope) : []), [cards, scope])
  const stats = useMemo(() => computePatternStats(selected), [selected])

  async function analyse() {
    if (!userId || !cards || running) return
    setViewing(null)
    const startedAt = Date.now()
    setRun({ status: 'running', text: '', count: selected.length, startedAt })
    requestAnimationFrame(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    let text = ''
    try {
      const res = await fetch('/api/sales-coach/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, scope }),
      })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error || 'The analysis could not start.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished: Extract<Run, { status: 'done' }> | null = null
      let failure: string | null = null
      let meta: { count: number; periodStart: string | null; periodEnd: string | null } = { count: selected.length, periodStart: stats.periodStart, periodEnd: stats.periodEnd }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''
        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue
          let j: { text?: string; meta?: typeof meta; done?: boolean; analysisId?: string | null; saved?: boolean; createdAt?: string | null; error?: string }
          try { j = JSON.parse(data) } catch { continue }
          if (j.meta) meta = j.meta
          if (j.text) {
            text += j.text
            setRun({ status: 'running', text, count: meta.count, startedAt })
          }
          if (j.error) failure = j.error
          if (j.done) {
            finished = { status: 'done', text, count: meta.count, scope, periodStart: meta.periodStart, periodEnd: meta.periodEnd, saved: Boolean(j.saved), createdAt: j.createdAt ?? null, analysisId: j.saved ? j.analysisId ?? null : null }
            if (j.analysisId && j.createdAt) {
              setAnalyses((prev) => [{ id: j.analysisId!, scope, card_count: meta.count, period_start: meta.periodStart, period_end: meta.periodEnd, created_by_name: null, created_at: j.createdAt! }, ...prev])
            }
          }
        }
      }
      if (failure) throw new Error(failure)
      if (!finished) throw new Error('The connection dropped before the analysis finished. Please try again.')
      setRun(finished)
    } catch (e) {
      setRun({ status: 'error', message: e instanceof Error ? e.message : 'The analysis could not be completed.' })
    }
  }

  async function openSaved(id: string) {
    if (running) return
    setOpeningId(id)
    try {
      const res = await fetch(`/api/sales-coach/patterns/${id}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not open that analysis.')
      setViewing(body.analysis as SavedAnalysis)
      setRun({ status: 'idle' })
      requestAnimationFrame(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (e) {
      setRun({ status: 'error', message: e instanceof Error ? e.message : 'Could not open that analysis.' })
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div className="flex flex-col gap-5 text-stone-900">
      <header className="flex flex-col gap-1.5">
        <p className={KICKER_GOLD}>Sales Coach · Admin</p>
        <h1 className="text-balance font-serif text-[26px] font-semibold leading-tight tracking-[-0.015em] text-stone-900 sm:text-[30px]">Sales Performance Reports</h1>
        <p className="max-w-2xl text-sm leading-6 text-stone-500">
          Read one Sales Executive&apos;s Report Cards together to see what keeps happening across their negotiations: the habits
          that win, the gaps that keep costing deals, whether they&apos;re improving, and what to coach next.
        </p>
      </header>

      {/* ── Controls ───────────────────────────────────────────── */}
      <section className={`${CARD} p-4 sm:p-6`}>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr),auto,auto] lg:items-end">
          <label className="flex min-w-0 flex-col gap-2">
            <span className={KICKER}>Sales Executive</span>
            <span className="relative">
              <select
                value={userId || ''}
                onChange={(e) => setUserId(e.target.value || null)}
                disabled={running}
                className={`w-full appearance-none rounded-xl border border-[#e3dfd7] bg-[#faf8f5] py-3 pl-4 pr-10 text-[15px] text-stone-900 transition hover:border-[#d4cec3] disabled:opacity-60 ${FOCUS}`}
              >
                <option value="">Choose a person…</option>
                {executives.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.cards} Report Card{e.cards === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <span className={KICKER}>Report Cards</span>
            <div role="radiogroup" aria-label="How many Report Cards" className="grid grid-cols-4 gap-1 rounded-xl bg-[#f3f1ec] p-1">
              {PATTERN_SCOPES.map((s) => {
                const n = cards?.length ?? 0
                const enabled = Boolean(cards) && scopeAvailable(s.id, n)
                const label = s.id === 'all' && cards ? `All (${Math.min(n, PATTERN_MAX_CARDS)})` : s.label
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={scope === s.id}
                    disabled={!enabled || running}
                    onClick={() => setScope(s.id)}
                    title={!enabled && cards ? `Only ${n} Report Card${n === 1 ? '' : 's'} available` : undefined}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 touch:py-2.5 text-xs font-medium transition ${FOCUS} ${
                      scope === s.id && enabled ? 'bg-white text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.08)] ring-1 ring-stone-900/10' : 'text-stone-600 hover:text-stone-900 disabled:text-stone-300 disabled:hover:text-stone-300'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={analyse}
            disabled={!cards || selected.length === 0 || running}
            className={`inline-flex items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 touch:py-3.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(28,25,23,0.25)] transition hover:bg-black disabled:opacity-40 ${FOCUS}`}
          >
            {running ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} className="text-[#e2c17f]" />}
            {running ? 'Analysing…' : selected.length ? `Analyse ${selected.length} Report Card${selected.length === 1 ? '' : 's'}` : 'Analyse'}
          </button>
        </div>
        <p className="mt-4 text-xs leading-5 text-stone-500">
          The AI reads each Report Card&apos;s ratings and evidence with the five TRC documents, and uses the counts below rather than
          counting itself. A meeting that was re-evaluated counts once, with its latest card. Usually 1–2 minutes.
        </p>
      </section>

      {!userId && (
        <section className={`${CARD} flex flex-col items-center gap-3 px-6 py-14 text-center`}>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fbf7ee] text-[#8f6626] ring-1 ring-inset ring-[#c8973f]/25"><UsersRound size={20} /></span>
          <p className="text-sm font-semibold text-stone-900">Choose a Sales Executive to begin</p>
          <p className="max-w-md text-xs leading-5 text-stone-500">
            {executives.length
              ? `${executives.length} people have Report Cards. Pick one, choose how many of their latest cards to read, and you'll get an instant snapshot before running the analysis.`
              : 'No one has a Report Card yet.'}
          </p>
        </section>
      )}

      {userId && loadingCards && (
        <section className={`${CARD} flex items-center justify-center gap-2 px-6 py-14 text-sm text-stone-500`}>
          <Loader2 size={15} className="animate-spin" /> Loading {executive?.name || 'their'} Report Cards…
        </section>
      )}

      {userId && loadError && (
        <section className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> {loadError}
        </section>
      )}

      {userId && cards && cards.length === 0 && (
        <section className={`${CARD} px-6 py-12 text-center text-sm text-stone-500`}>{executive?.name} has no Report Cards yet.</section>
      )}

      {userId && cards && selected.length > 0 && (
        <>
          <Snapshot stats={stats} cards={selected} />

          {/* ── The AI analysis ─────────────────────────────────── */}
          <div ref={analysisRef} className="scroll-mt-20">
            <AnalysisPanel
              run={run}
              viewing={viewing}
              name={executive?.name || ''}
              firstName={firstName}
              selectedCount={selected.length}
              historyAvailable={historyAvailable}
              canDownloadPdf={canDownloadPdf}
              onAnalyse={analyse}
              onCloseSaved={() => setViewing(null)}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr),minmax(0,1fr)]">
            <IncludedCards cards={selected} />
            <section className={`${CARD} p-4 sm:p-6`}>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-stone-900"><History size={15} className="text-[#a07530]" /> Previous analyses</h2>
              {!historyAvailable ? (
                <p className="mt-3 text-xs leading-5 text-stone-500">
                  Analyses aren&apos;t kept yet: the database update for them (migration 045) hasn&apos;t been run. Each analysis still shows here when it finishes.
                </p>
              ) : analyses.length === 0 ? (
                <p className="mt-3 text-xs leading-5 text-stone-500">None yet for {firstName || 'this person'}. Each analysis you run is kept here.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {analyses.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => openSaved(a.id)}
                        disabled={running}
                        className={`group flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left ring-1 ring-inset transition ${FOCUS} ${
                          viewing?.id === a.id ? 'bg-[#fbf7ee] ring-[#c8973f]/40' : 'bg-[#faf8f5] ring-[#ece8e1] hover:bg-white hover:ring-[#d8d1c5]'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-stone-900">
                            {PATTERN_SCOPES.find((s) => s.id === a.scope)?.label ?? a.scope} · {a.card_count} Report Card{a.card_count === 1 ? '' : 's'}
                          </span>
                          <span className="mt-0.5 block text-xs text-stone-500">
                            {formatDayMonthYearTime(a.created_at)}{a.created_by_name ? ` · by ${a.created_by_name}` : ''}
                          </span>
                        </span>
                        {openingId === a.id ? <Loader2 size={14} className="flex-shrink-0 animate-spin text-stone-400" /> : <ChevronDown size={14} className="flex-shrink-0 -rotate-90 text-stone-300 transition group-hover:text-[#a07530]" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

// ── Snapshot: free, instant, computed in code ────────────────────────────

function Snapshot({ stats, cards }: { stats: PatternStats; cards: PatternCardSummary[] }) {
  const band = scoreBand(stats.averagePct)
  const delta = stats.earlierAvg !== null && stats.laterAvg !== null ? stats.laterAvg - stats.earlierAvg : null
  const halfSize = Math.floor(stats.scoredCount / 2)
  return (
    <section className={`${CARD} p-4 sm:p-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-stone-900">Snapshot</h2>
        <p className="text-xs text-stone-500">Counted from the Report Cards, no AI · {period(stats.periodStart, stats.periodEnd)}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Report Cards" value={String(stats.count)} sub={period(stats.periodStart, stats.periodEnd)} />
        <StatTile
          label="Average score"
          value={stats.averagePct === null ? '—' : `${stats.averagePct}%`}
          sub={band ? (
            <span className={`inline-flex items-center gap-1.5 ${BAND_TONE[band.tone].text}`}><span className={`h-1.5 w-1.5 rounded-full ${BAND_TONE[band.tone].dot}`} />{band.label}</span>
          ) : 'No calculable scores'}
        />
        <StatTile
          label="Trend"
          value={delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta} pts`}
          icon={delta === null ? null : delta > 2 ? <ArrowUpRight size={18} className="text-emerald-600" /> : delta < -2 ? <ArrowDownRight size={18} className="text-rose-600" /> : <Minus size={18} className="text-stone-400" />}
          sub={delta === null ? 'Needs 4+ scored cards' : `Latest ${halfSize} vs earlier ${halfSize}: ${stats.earlierAvg}% → ${stats.laterAvg}%`}
        />
        <div className="rounded-xl bg-[#faf8f5] px-4 py-3.5 ring-1 ring-inset ring-[#ece8e1]">
          <p className="text-xs text-stone-500">Outcomes</p>
          <ul className="mt-2 flex flex-col gap-1">
            {OUTCOMES.map((o) => (
              <li key={o.key} className="flex items-center justify-between gap-2 text-[12.5px] text-stone-700">
                <span className="flex min-w-0 items-center gap-1.5"><span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${o.dot}`} /><span className="truncate">{o.label}</span></span>
                <span className="font-semibold tabular-nums text-stone-900">{stats.outcomes[o.key]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr),minmax(0,1.15fr)]">
        <div>
          <p className={KICKER}>Score, negotiation by negotiation</p>
          <ScoreTrend cards={cards} />
        </div>
        <div>
          <p className={KICKER}>Each criterion across these Report Cards</p>
          <CriteriaBreakdown stats={stats} />
        </div>
      </div>
    </section>
  )
}

function StatTile({ label, value, sub, icon }: { label: string; value: string; sub: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#faf8f5] px-4 py-3.5 ring-1 ring-inset ring-[#ece8e1]">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-stone-900">{value}{icon}</p>
      <p className="mt-1 text-[12px] leading-5 text-stone-500">{sub}</p>
    </div>
  )
}

// One series (the score), oldest to newest, with the band thresholds as
// hairlines. Hover or focus a point for its negotiation; click to open it.
function ScoreTrend({ cards }: { cards: PatternCardSummary[] }) {
  const points = useMemo(
    () => [...cards].sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).filter((c) => c.pct !== null),
    [cards],
  )
  const [hover, setHover] = useState<number | null>(null)
  if (points.length === 0) return <p className="mt-3 text-sm text-stone-500">None of these Report Cards has a calculable score.</p>

  const W = 560, H = 190, padL = 30, padR = 14, padT = 12, padB = 12
  const x = (i: number) => (points.length === 1 ? (padL + W - padR) / 2 : padL + (i * (W - padL - padR)) / (points.length - 1))
  const y = (pct: number) => padT + ((100 - pct) * (H - padT - padB)) / 100
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pct as number).toFixed(1)}`).join(' ')
  const active = hover !== null ? points[hover] : null

  return (
    <div className="relative mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={`Execution score across ${points.length} negotiations`}>
        {[0, 50, 80, 100].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#e7e3dc' : '#f0ede7'} strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" className="fill-stone-400 text-[10px] tabular-nums">{t}</text>
          </g>
        ))}
        {points.length > 1 && <path d={path} fill="none" stroke="#a07530" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => {
          const band = scoreBand(p.pct)
          return (
            <g key={p.id}>
              <circle cx={x(i)} cy={y(p.pct as number)} r={hover === i ? 6 : 4.5} fill={band ? BAND_TONE[band.tone].ring : '#a8a29e'} stroke="#fff" strokeWidth={2} />
              <circle
                cx={x(i)}
                cy={y(p.pct as number)}
                r={13}
                fill="transparent"
                tabIndex={0}
                role="link"
                aria-label={`${p.company || 'Negotiation'}, ${longDate(p.created_at)}: ${p.pct}%`}
                className="cursor-pointer outline-none"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => window.open(`/commercial/sales-coach/${p.id}`, '_blank')}
                onKeyDown={(e) => { if (e.key === 'Enter') window.open(`/commercial/sales-coach/${p.id}`, '_blank') }}
              />
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex justify-between pl-[30px] text-[11px] text-stone-400">
        <span>{shortDate(points[0].created_at)}</span>
        {points.length > 1 && <span>{shortDate(points[points.length - 1].created_at)}</span>}
      </div>
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[15rem] -translate-x-1/2 -translate-y-full rounded-lg bg-stone-900 px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(active.pct as number) / H) * 100}%`, marginTop: -12 }}
        >
          <p className="font-semibold">{active.company || 'Negotiation'}</p>
          <p className="mt-0.5 text-white/70">{longDate(active.created_at)} · {active.pct}%</p>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-4 text-stone-400">Lines at 50 and 80 mark the score bands. Select a point to open that Report Card.</p>
    </div>
  )
}

function CriteriaBreakdown({ stats }: { stats: PatternStats }) {
  return (
    <div className="mt-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-stone-600">
        {VERDICT_SEGMENTS.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">{s.icon}{s.label}</li>
        ))}
      </ul>
      <ul className="mt-3 flex flex-col divide-y divide-[#f0ede7]">
        {stats.criteria.map((c) => {
          const total = c.pass + c.warn + c.fail + c.uv + c.na
          const move = c.earlierCredit !== null && c.laterCredit !== null ? c.laterCredit - c.earlierCredit : null
          return (
            <li key={c.key} className="grid grid-cols-1 gap-1.5 py-2.5 sm:grid-cols-[11rem,minmax(0,1fr),6.5rem] sm:items-center sm:gap-3">
              <span className="min-w-0 truncate text-[13px] font-medium text-stone-800"><span className="mr-1.5 tabular-nums text-stone-400">{c.number}</span>{c.label}</span>
              <span className="flex h-2 w-full gap-[2px]" aria-hidden>
                {total === 0
                  ? <span className="h-2 w-full rounded-full bg-stone-100" />
                  : VERDICT_SEGMENTS.map((s) => c[s.key] > 0 && (
                    <span
                      key={s.key}
                      title={`${s.label}: ${c[s.key]} of ${total}`}
                      className={`h-2 rounded-full ${s.bar}`}
                      style={{ width: `${(c[s.key] / total) * 100}%` }}
                    />
                  ))}
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-stone-600 sm:justify-end">
                {c.applicable > 0 ? <>Strong {c.pass}/{c.applicable}</> : <span className="text-stone-400">Not rated</span>}
                {move !== null && Math.abs(move) >= 5 && (
                  <span className={`inline-flex items-center font-medium ${move > 0 ? 'text-emerald-700' : 'text-rose-700'}`} title={`Earlier ${c.earlierCredit}% → recent ${c.laterCredit}% of the available credit`}>
                    {move > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  </span>
                )}
              </span>
              <span className="sr-only">
                {VERDICT_SEGMENTS.map((s) => `${s.label} ${c[s.key]}`).join(', ')}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-4 text-stone-400">&quot;Strong 5/9&quot;: rated Strong in 5 of the 9 Report Cards where it applied. An arrow marks a clear change between the earlier and the more recent half.</p>
    </div>
  )
}

// ── The analysis ──────────────────────────────────────────────────────────

function AnalysisPanel({ run, viewing, name, firstName, selectedCount, historyAvailable, canDownloadPdf, onAnalyse, onCloseSaved }: {
  run: Run
  viewing: SavedAnalysis | null
  name: string
  firstName: string
  selectedCount: number
  historyAvailable: boolean
  canDownloadPdf: boolean
  onAnalyse: () => void
  onCloseSaved: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  // Keyed on the start time, not the run object (which changes with every
  // streamed word and would keep resetting the interval).
  const startedAt = run.status === 'running' ? run.startedAt : null
  useEffect(() => {
    if (startedAt === null) return
    setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [startedAt])

  if (viewing) {
    return (
      <AnalysisDocument
        kicker="Saved sales performance report"
        title={`${name} · ${PATTERN_SCOPES.find((s) => s.id === viewing.scope)?.label.toLowerCase() ?? viewing.scope} ${viewing.card_count} Report Card${viewing.card_count === 1 ? '' : 's'}`}
        meta={`${period(viewing.period_start, viewing.period_end)} · ${formatDayMonthYearTime(viewing.created_at)}${viewing.created_by_name ? ` · by ${viewing.created_by_name}` : ''}`}
        text={viewing.output}
        pdfHref={canDownloadPdf ? `/api/sales-coach/patterns/${viewing.id}/pdf` : undefined}
        onClose={onCloseSaved}
      />
    )
  }

  if (run.status === 'running') {
    return (
      <section className={`${CARD} overflow-hidden`}>
        <div aria-hidden className="h-[3px] animate-pulse bg-gradient-to-r from-[#e6cf9c] via-[#b8862f] to-[#e6cf9c]" />
        <div className="px-5 py-6 sm:px-10 sm:py-8">
          <p className={`flex items-center gap-2 ${KICKER_GOLD}`}><Loader2 size={13} className="animate-spin" /> Analysing {run.count} Report Card{run.count === 1 ? '' : 's'} · {elapsed}s</p>
          {run.text ? (
            <div className="pattern-prose mt-5" dangerouslySetInnerHTML={{ __html: marked.parse(run.text) as string }} />
          ) : (
            <div className="mt-5 flex flex-col gap-3">
              <p className="text-sm text-stone-500">Reading {firstName ? `${firstName}'s` : 'the'} Report Cards against the TRC documents…</p>
              {[92, 78, 85, 60].map((w, i) => <span key={i} className="h-3 animate-pulse rounded-full bg-stone-100" style={{ width: `${w}%` }} />)}
            </div>
          )}
        </div>
      </section>
    )
  }

  if (run.status === 'done') {
    return (
      <AnalysisDocument
        kicker="Sales performance report"
        title={`${name} · ${run.scope === 'all' ? 'all' : `last ${run.count}`} Report Card${run.count === 1 ? '' : 's'}`}
        meta={`${period(run.periodStart, run.periodEnd)}${run.createdAt ? ` · ${formatDayMonthYearTime(run.createdAt)}` : ''}${run.saved ? ' · saved' : historyAvailable ? '' : ' · not kept (migration 045 not run)'}`}
        text={run.text}
        pdfHref={canDownloadPdf && run.analysisId ? `/api/sales-coach/patterns/${run.analysisId}/pdf` : undefined}
      />
    )
  }

  return (
    <section className={`${CARD} relative overflow-hidden`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_100%_0%,rgba(200,151,63,0.10),transparent_60%)]" />
      <div className="relative flex flex-col gap-5 px-5 py-6 sm:px-10 sm:py-8 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className={`flex items-center gap-2 ${KICKER_GOLD}`}><Sparkles size={13} /> AI sales performance report</p>
          <h2 className="mt-2 font-serif text-[20px] font-medium leading-snug text-stone-900 sm:text-[22px]">
            What keeps happening across {firstName ? `${firstName}'s` : 'these'} negotiations
          </h2>
          <p className="mt-2 max-w-xl text-[13.5px] leading-6 text-stone-600">
            Recurring strengths and gaps with the negotiations they come from, whether the score is moving, the objections that keep
            coming up, how follow-ups are left, and a three-point coaching plan grounded in the TRC documents.
          </p>
          {run.status === 'error' && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><AlertCircle size={13} className="mt-0.5 flex-shrink-0" />{run.message}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onAnalyse}
          className={`inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 touch:py-3.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(28,25,23,0.25)] transition hover:bg-black ${FOCUS}`}
        >
          <Sparkles size={15} className="text-[#e2c17f]" />
          {run.status === 'error' ? 'Try again' : `Analyse ${selectedCount} Report Card${selectedCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </section>
  )
}

function AnalysisDocument({ kicker, title, meta, text, pdfHref, onClose }: { kicker: string; title: string; meta: string; text: string; pdfHref?: string; onClose?: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div aria-hidden className="h-[3px] bg-gradient-to-r from-[#e6cf9c] via-[#b8862f] to-[#e6cf9c]" />
      <header className="flex flex-col gap-3 border-b border-[#ece9e3] bg-[#fbf9f5] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <div className="min-w-0">
          <p className={`flex items-center gap-2 ${KICKER_GOLD}`}><Sparkles size={12} /> {kicker}</p>
          <p className="mt-1 truncate text-[15px] font-semibold text-stone-900">{title}</p>
          <p className="mt-0.5 text-xs text-stone-500">{meta}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }}
            className={`inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 touch:py-2.5 text-xs font-medium text-stone-800 ring-1 ring-inset ring-stone-900/10 transition hover:ring-stone-900/20 ${FOCUS}`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy as text'}
          </button>
          {pdfHref && (
            <a
              href={pdfHref}
              download
              className={`inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3.5 py-2 touch:py-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgba(28,25,23,0.25)] transition hover:bg-black ${FOCUS}`}
            >
              <FileDown size={13} className="text-[#e2c17f]" /> Download PDF
            </a>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className={`rounded-lg px-3 py-2 touch:py-2.5 text-xs font-medium text-stone-500 transition hover:text-stone-900 ${FOCUS}`}>
              Close
            </button>
          )}
        </div>
      </header>
      <div className="pattern-prose px-5 py-6 sm:px-10 sm:py-8" dangerouslySetInnerHTML={{ __html: marked.parse(text) as string }} />
    </section>
  )
}

function IncludedCards({ cards }: { cards: PatternCardSummary[] }) {
  const [open, setOpen] = useState(false)
  const shown = open ? cards : cards.slice(0, 5)
  return (
    <section className={`${CARD} p-4 sm:p-6`}>
      <h2 className="text-[15px] font-semibold text-stone-900">Report Cards in this analysis</h2>
      <p className="mt-0.5 text-xs text-stone-500">Newest first. Each opens in a new tab.</p>
      <ul className="mt-3 flex flex-col divide-y divide-[#f0ede7]">
        {shown.map((c) => {
          const outcome = OUTCOMES.find((o) => o.key === c.declared_outcome)
          return (
            <li key={c.id}>
              <Link
                href={`/commercial/sales-coach/${c.id}`}
                target="_blank"
                className="group flex items-center justify-between gap-3 py-2.5 touch:py-3"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-stone-900">
                    <span className="truncate">{c.company || 'Untitled negotiation'}</span>
                    <ExternalLink size={12} className="flex-shrink-0 text-stone-300 transition group-hover:text-[#a07530]" />
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                    <span>{longDate(c.created_at)}</span>
                    {outcome && <span className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${outcome.dot}`} />{outcome.label}</span>}
                  </span>
                </span>
                <ScorePill pct={c.pct} />
              </Link>
            </li>
          )
        })}
      </ul>
      {cards.length > 5 && (
        <button type="button" onClick={() => setOpen((v) => !v)} className={`mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-stone-600 transition hover:text-stone-900 ${FOCUS}`}>
          <ChevronDown size={13} className={open ? 'rotate-180' : ''} /> {open ? 'Show fewer' : `Show all ${cards.length}`}
        </button>
      )}
    </section>
  )
}
