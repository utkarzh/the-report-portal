'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Globe, ListChecks, Minus, PenLine, Search, type LucideIcon } from 'lucide-react'
import type { ResearchProvider } from '@/types'

// The research card's waiting screen. Everything on it is real: the searches
// the engine is running, the sites it reads and the facts it collects, all
// streamed from /api/generate. So the minute or two before the research
// starts writing shows the work being done instead of a spinner. Once the
// first words arrive, the card switches to the live text.

export interface LaneProgress {
  title: string
  status: 'searching' | 'done' | 'empty'
  facts: number
}

export interface ResearchProgressState {
  startedAt: number
  // Gemini: the research areas it planned, filled in as each one lands.
  lanes: LaneProgress[]
  queries: string[]
  sources: string[]
  searches: number
  facts: number
}

export function emptyProgress(): ResearchProgressState {
  return { startedAt: Date.now(), lanes: [], queries: [], sources: [], searches: 0, facts: 0 }
}

const mergeUnique = (a: string[], b: unknown): string[] => {
  const add = (Array.isArray(b) ? b : []).filter((x): x is string => typeof x === 'string' && !!x && !a.includes(x))
  return add.length ? [...a, ...new Set(add)] : a
}

// Folds one /api/generate event into the waiting screen's state. Returns the
// same object for events that don't concern it, so React skips the render.
export function applyProgressEvent(p: ResearchProgressState, e: Record<string, unknown>): ResearchProgressState {
  if (Array.isArray(e.plan)) {
    const lanes = e.plan.filter((t): t is string => typeof t === 'string')
    return { ...p, lanes: lanes.map((title) => ({ title, status: 'searching', facts: 0 })) }
  }
  const lane = e.lane as { index?: unknown; facts?: unknown; searches?: unknown; queries?: unknown; sources?: unknown } | undefined
  if (lane && typeof lane.index === 'number') {
    const facts = typeof lane.facts === 'number' ? lane.facts : 0
    return {
      ...p,
      lanes: p.lanes.map((l, i) => (i === lane.index ? { ...l, status: facts > 0 ? 'done' : 'empty', facts } : l)),
      facts: p.facts + facts,
      searches: p.searches + (typeof lane.searches === 'number' ? lane.searches : 0),
      queries: mergeUnique(p.queries, lane.queries),
      sources: mergeUnique(p.sources, lane.sources),
    }
  }
  // The run fell back from Gemini to Claude: its lanes no longer apply.
  if (e.engine === 'claude' && p.lanes.length) return { ...p, lanes: [], facts: 0 }
  if (typeof e.query === 'string') return { ...p, queries: mergeUnique(p.queries, [e.query]) }
  if (Array.isArray(e.sources)) return { ...p, sources: mergeUnique(p.sources, e.sources) }
  if (e.status === 'web_search_start' && typeof e.searches === 'number') return { ...p, searches: e.searches }
  return p
}

interface Props {
  engine: ResearchProvider | null
  progress: ResearchProgressState
  // The latest event was a search starting (Claude engine).
  searching: boolean
  // Gemini engine: Claude has started writing from this many facts.
  writingFrom: number | null
  // The run was started elsewhere and this page is polling for the result.
  background: boolean
}

const MAX_SOURCE_CHIPS = 12
const RECENT_QUERIES = 4

export default function ResearchProgress({ engine, progress, searching, writingFrom, background }: Props) {
  const elapsed = useElapsed(progress.startedAt, !background)
  const gemini = engine === 'gemini'
  const writing = writingFrom !== null
  const lanesLanded = progress.lanes.length > 0 && progress.lanes.every((l) => l.status !== 'searching')

  let icon: LucideIcon = Search
  let title: string
  let detail: string
  if (background) {
    title = 'Researching in the background'
    detail = 'This research was started earlier. It will appear here the moment it’s ready.'
  } else if (writing) {
    icon = PenLine
    title = 'Writing up the research'
    detail = `Turning ${writingFrom} sourced facts into the research. The text appears here as it’s written.`
  } else if (gemini && !progress.lanes.length) {
    icon = ListChecks
    title = 'Planning the research'
    detail = 'Turning the interview’s themes into targeted Google searches.'
  } else if (gemini) {
    icon = Globe
    title = lanesLanded ? 'Collecting the sources' : 'Searching Google'
    detail = lanesLanded
      ? 'Linking every fact to the page it came from.'
      : 'Checking the current role, latest results and news against official sources.'
  } else {
    title = searching || !progress.searches ? 'Searching the web' : 'Reading the results'
    detail = 'Verifying the current role, latest results and news before anything is written.'
  }

  const steps = gemini ? ['Plan the searches', 'Search Google', 'Write the research'] : ['Search the web', 'Write the research']
  const step = gemini ? (writing ? 2 : progress.lanes.length ? 1 : 0) : writing ? 1 : 0

  const recentQueries = progress.queries.slice(-RECENT_QUERIES).reverse()
  const chips = progress.sources.slice(0, MAX_SOURCE_CHIPS)
  const moreSources = progress.sources.length - chips.length

  return (
    <div className="py-2">
      <div className="flex items-start gap-4">
        <Emblem icon={icon} />
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-baseline justify-between gap-3">
            <p key={title} className="fade-up text-sm font-semibold text-gray-900">{title}</p>
            {!background && (
              <span className="flex-shrink-0 text-[11px] font-medium tabular-nums text-gray-400">{formatElapsed(elapsed)}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{detail}</p>
        </div>
      </div>

      {!background && <StepTrack steps={steps} active={step} />}

      {(progress.searches > 0 || progress.facts > 0 || progress.sources.length > 0) && (
        <div className="mt-5 flex flex-wrap gap-2">
          {progress.searches > 0 && <Stat icon={Search} value={progress.searches} label={progress.searches === 1 ? 'search' : 'searches'} />}
          {progress.facts > 0 && <Stat icon={Check} value={progress.facts} label="facts" />}
          {progress.sources.length > 0 && <Stat icon={Globe} value={progress.sources.length} label={progress.sources.length === 1 ? 'site' : 'sites'} />}
        </div>
      )}

      {progress.lanes.length > 0 && (
        <ul className="mt-5 divide-y divide-[#efedea] overflow-hidden rounded-xl border border-[#e5e3df]">
          {progress.lanes.map((lane, i) => (
            <li
              key={`${i}-${lane.title}`}
              className="fade-up flex items-center gap-3 bg-white px-4 py-2.5"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <LaneMark status={lane.status} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700">{lane.title}</span>
              <span className={`flex-shrink-0 text-[11px] tabular-nums ${lane.status === 'searching' ? 'animate-pulse text-gray-400' : 'text-gray-500'}`}>
                {lane.status === 'searching' ? 'searching…' : lane.status === 'done' ? `${lane.facts} facts` : 'nothing found'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {recentQueries.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Latest searches</p>
          <ul className="space-y-1.5">
            {recentQueries.map((q) => (
              <li key={q} className="fade-up flex items-start gap-2 text-xs text-gray-600">
                <Search size={12} className="mt-0.5 flex-shrink-0 text-gray-400" />
                <span className="min-w-0 truncate">{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            {gemini ? 'Sources behind the facts' : 'Sites read'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((host) => (
              <span key={host} className="fade-up rounded-full border border-[#e5e3df] bg-[#faf9f7] px-2.5 py-1 text-[11px] text-gray-600">
                {host}
              </span>
            ))}
            {moreSources > 0 && <span className="px-1.5 py-1 text-[11px] text-gray-400">+{moreSources} more</span>}
          </div>
        </div>
      )}

      {writing ? (
        <div className="mt-6">
          <WritingSkeleton />
        </div>
      ) : (
        <p className="mt-6 text-[11px] leading-relaxed text-gray-400">
          {background
            ? 'This page updates automatically.'
            : gemini
            ? 'The search usually takes under a minute, then the research writes out here live. You can leave this page: it keeps going and will be here when you come back.'
            : 'The search usually takes a minute or two, then the research writes out here live. You can leave this page: it keeps going and will be here when you come back.'}
        </p>
      )}
    </div>
  )
}

// Shown in the questions card until the first words arrive.
export function DraftingPlaceholder({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="py-2">
      <div className="flex items-start gap-4">
        <Emblem icon={PenLine} />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{detail}</p>
        </div>
      </div>
      <div className="mt-6">
        <WritingSkeleton />
      </div>
    </div>
  )
}

// The app's glowing emblem (see the research start screen), sized for a card.
function Emblem({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center">
      <div className="gemini-aurora absolute -inset-1 rounded-full opacity-60 blur-lg" />
      <div className="gemini-bloom absolute inset-0 rounded-full blur-xl" />
      <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[#e5e3df] bg-white shadow-sm">
        <Icon key={Icon.displayName} size={18} className="gemini-sparkle text-gray-800" />
      </div>
    </div>
  )
}

function StepTrack({ steps, active }: { steps: string[]; active: number }) {
  return (
    <div className="mt-5 flex items-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className={`flex items-center gap-2 ${i < steps.length - 1 ? 'flex-1' : ''}`}>
          <span
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${
              i < active
                ? 'border-gray-900 bg-gray-900 text-white'
                : i === active
                ? 'border-gray-900 bg-white text-gray-900 ring-4 ring-gray-900/10'
                : 'border-[#d9d6d0] bg-white text-gray-400'
            }`}
          >
            {i < active ? <Check size={11} /> : i + 1}
          </span>
          <span className={`whitespace-nowrap text-[11px] ${i <= active ? 'font-medium text-gray-800' : 'text-gray-400'}`}>{label}</span>
          {i < steps.length - 1 && (
            <span className={`h-[2px] min-w-[16px] flex-1 rounded-full ${i < active ? 'bg-gray-900' : i === active ? 'flow-line' : 'bg-[#e5e3df]'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-2.5 py-1.5 text-xs text-gray-500 shadow-sm">
      <Icon size={12} className="text-gray-400" />
      <AnimatedNumber value={value} />
      <span>{label}</span>
    </span>
  )
}

function LaneMark({ status }: { status: LaneProgress['status'] }) {
  if (status === 'searching') {
    return <span className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-[#e5e3df] border-t-gray-700" />
  }
  if (status === 'done') {
    return (
      <span className="fade-up flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-white">
        <Check size={10} />
      </span>
    )
  }
  return (
    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-[#d9d6d0] text-gray-400">
      <Minus size={10} />
    </span>
  )
}

const SKELETON_WIDTHS = ['94%', '81%', '88%', '67%']

function WritingSkeleton() {
  return (
    <div className="space-y-2.5" aria-hidden>
      {SKELETON_WIDTHS.map((width, i) => (
        <div key={width} className="relative h-2.5 overflow-hidden rounded-full bg-[#efedea]" style={{ width }}>
          <div className="content-shimmer absolute inset-0" style={{ animationDelay: `${i * 150}ms` }} />
        </div>
      ))}
    </div>
  )
}

// Counts up to a new value instead of jumping.
function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value)
  const shownRef = useRef(value)
  useEffect(() => {
    const from = shownRef.current
    if (from === value) return
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 500)
      const next = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3)))
      shownRef.current = next
      setShown(next)
      if (k < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <span className="font-semibold tabular-nums text-gray-800">{shown}</span>
}

function useElapsed(startedAt: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [running])
  return Math.max(0, Math.floor((now - startedAt) / 1_000))
}

function formatElapsed(secs: number): string {
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`
}
