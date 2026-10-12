'use client'

import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, HelpCircle, Quote, MessageCircleQuestion, Play, Flag, MessageSquare, ArrowDown, TrendingUp } from 'lucide-react'
import { SALES_COACH_CRITERIA, formatTimestamp, scoreBand, scoreOpportunities, scorePercent, unverifiedNote } from '@/lib/sales-coach'
import { BAND_TONE, ScoreRing } from '@/components/sales-coach/ScoreDisplay'
import { formatDayMonthYearTime, formatDayMonth } from '@/lib/date-format'
import type { SalesCoachReportCard, SalesCoachCriterion, SalesCoachVerdict, SalesCoachOutcome, SalesCoachCorrection } from '@/types'

// The Report Card as ONE document (US-039/040/041): identity header →
// score (percentage ring + plain-language band + breakdown) → where to focus
// next → summary → nine criteria with verbatim evidence → scoreline recap
// → deeper analysis → the single coaching question — all inside a single
// paper-like card, in the order of the client's sample. renderReportCardMarkdown()
// is the text twin of this view; both read the same object.

const VERDICT: Record<SalesCoachVerdict, { label: string; chip: string; icon: React.ReactNode }> = {
  pass: { label: 'Met', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: <CheckCircle2 size={13} /> },
  warn: { label: 'Partly met', chip: 'bg-amber-50 text-amber-700 ring-amber-200', icon: <AlertTriangle size={13} /> },
  fail: { label: 'Not met', chip: 'bg-red-50 text-red-700 ring-red-200', icon: <XCircle size={13} /> },
  na: { label: 'Not applicable', chip: 'bg-stone-100 text-stone-600 ring-stone-200', icon: <MinusCircle size={13} /> },
  uv: { label: 'Verify audio', chip: 'bg-sky-50 text-sky-700 ring-sky-200', icon: <HelpCircle size={13} /> },
}

const OUTCOME_TONE: Record<SalesCoachOutcome, string> = {
  signed: 'bg-emerald-600 text-white',
  retorno: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
  lost: 'bg-red-50 text-red-800 ring-1 ring-red-200',
  uncertain: 'bg-stone-100 text-stone-700 ring-1 ring-stone-200',
}

export interface ReportCardMeta {
  company: string | null
  interviewee: string | null
  publication: string | null
  country: string | null
  submittedBy: string | null
  date: string
  generatedAt?: string | null
  modelUsed?: string | null
}

export type FlagHandler = (criterionKey: string | null, fieldLabel: string, aiSaid: string) => void

export default function ReportCardView({
  card,
  meta,
  onTimestampClick,
  corrections = [],
  onFlag,
  onDiscussCoachingQuestion,
  hasCoachingHistory,
  onStartCoaching,
}: {
  card: SalesCoachReportCard
  meta: ReportCardMeta
  onTimestampClick?: (ms: number) => void
  corrections?: SalesCoachCorrection[]
  onFlag?: FlagHandler
  onDiscussCoachingQuestion?: () => void
  // First-visit nudge at the top of the card, right after the score — the
  // moment attention is highest, rather than only inviting coaching after a
  // full scroll to the Final Coaching Question at the bottom.
  hasCoachingHistory?: boolean
  onStartCoaching?: () => void
}) {
  const scored = card.criteria.filter((c) => c.scored)
  const count = (v: SalesCoachVerdict) => scored.filter((c) => c.verdict === v).length
  const pct = scorePercent(card.execution_score, card.execution_denominator)
  const band = scoreBand(pct)
  const focus = scoreOpportunities(card).slice(0, 2)
  const strengths = scored.filter((c) => c.verdict === 'pass').map(criterionLabel)
  const uvNote = unverifiedNote(card.criteria)

  return (
    <article className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
      {/* ── Identity ─────────────────────────────────────────────── */}
      <header className="px-6 pb-6 pt-8 text-center sm:px-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#a07530]">TRC Sales Coach · Report Card</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">{meta.company || 'Negotiation'}</h2>
        <p className="mt-2 text-sm text-gray-600">
          {[meta.interviewee, [meta.publication, meta.country].filter(Boolean).join(' · ')].filter(Boolean).join('  ·  ') || '—'}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Negotiation of {new Date(meta.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          {meta.submittedBy ? ` · Submitted by ${meta.submittedBy}` : ''}
        </p>
      </header>

      {/* ── Score ────────────────────────────────────────────────── */}
      <div className="mx-6 rounded-xl bg-[#faf9f7] px-6 py-6 sm:mx-12">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <ScoreRing pct={pct} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            {band ? (
              <>
                <p className={`text-lg font-semibold tracking-tight ${BAND_TONE[band.tone].text}`}>{band.label}</p>
                <p className="mt-1 text-sm leading-6 text-gray-600">{band.hint}</p>
              </>
            ) : (
              <p className="text-sm leading-6 text-gray-600">There wasn&apos;t enough verifiable material in the recording to calculate a score.</p>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${card.declared_outcome ? OUTCOME_TONE[card.declared_outcome] : 'bg-stone-100 text-stone-700'}`}>
                {card.commercial_outcome_label}
              </span>
            </div>
          </div>
        </div>

        {scored.length > 0 && (
          <div className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">How your score breaks down</p>
              <p className="whitespace-nowrap text-[11px] text-gray-500">
                {[count('pass') && `${count('pass')} met`, count('warn') && `${count('warn')} partly`, count('fail') && `${count('fail')} missed`].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="mt-2 flex gap-1">
              {scored.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => scrollToCriterion(c.key)}
                  title={`${criterionLabel(c)} — ${VERDICT[c.verdict].label}`}
                  className={`h-2.5 flex-1 rounded-full transition-opacity hover:opacity-70 ${SEGMENT[c.verdict]}`}
                />
              ))}
            </div>
            {strengths.length > 0 && (
              <p className="mt-3 text-xs leading-5 text-gray-600">
                <span className="font-semibold text-emerald-700">What landed: </span>
                {strengths.join(', ')}
              </p>
            )}
            {uvNote && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-gray-500">
                <HelpCircle size={12} className="mt-0.5 flex-shrink-0 text-sky-500" />
                {uvNote}
              </p>
            )}
          </div>
        )}

        <p className="mt-5 border-t border-[#e9e7e2] pt-4 text-[15px] font-medium leading-relaxed text-gray-900">{card.headline}</p>
      </div>

      {/* ── Where to focus next ──────────────────────────────────────── */}
      {focus.length > 0 && (
        <div className="mx-6 mt-4 rounded-xl border border-[#e5e3df] bg-[#fffdf8] px-5 py-4 sm:mx-12">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">
            <TrendingUp size={12} /> Where to focus next
          </p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {focus.map((f) => (
              <li key={f.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <p className="text-sm text-gray-800">
                  <span className="font-semibold text-gray-900">{f.label}</span>
                  <span className={`ml-2 text-xs font-medium ${f.verdict === 'fail' ? 'text-red-700' : 'text-amber-700'}`}>
                    {f.verdict === 'fail' ? 'Missed' : 'Partly done'}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">Getting this fully right would take you to {f.reachPct}%.</span>
                </p>
                <button
                  type="button"
                  onClick={() => scrollToCriterion(f.key)}
                  className="inline-flex flex-shrink-0 items-center gap-1 self-start text-xs font-medium text-gray-600 transition-colors hover:text-black sm:self-center"
                >
                  See what to change <ArrowDown size={12} />
                </button>
              </li>
            ))}
          </ul>
          {onStartCoaching && !hasCoachingHistory && (
            <div className="mt-4 flex flex-col items-start gap-3 border-t border-[#efe9dc] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-700">Your coach has read this card and can walk you through {focus[0].label} step by step.</p>
              <button
                type="button"
                onClick={onStartCoaching}
                className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-black px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-900"
              >
                <MessageSquare size={13} /> Practise with your coach
              </button>
            </div>
          )}
        </div>
      )}
      {focus.length === 0 && onStartCoaching && !hasCoachingHistory && (
        <div className="mx-6 mt-4 flex flex-col items-start gap-3 rounded-xl border border-[#e5e3df] bg-[#fffdf8] px-5 py-3.5 sm:mx-12 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-700">
            <span className="font-medium text-gray-900">Every step that applied was met.</span>{' '}
            Your coach can help you make the next one even sharper.
          </p>
          <button
            type="button"
            onClick={onStartCoaching}
            className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-black px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-900"
          >
            <MessageSquare size={13} /> Start coaching
          </button>
        </div>
      )}

      <div className="px-6 sm:px-12">
        {corrections.length > 0 && (
          <div className="mt-6 rounded-xl bg-[#faf9f7] p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              <Flag size={11} className="text-[#a07530]" /> Corrections on record
            </p>
            <div className="mt-2.5 flex flex-col gap-2.5">
              {corrections.map((c) => (
                <div key={c.id} className="text-sm leading-6 text-gray-800">
                  <span className="font-semibold text-gray-900">{c.field_label}. </span>
                  {c.correction}
                  <span className="ml-1.5 text-xs text-gray-400">· {formatDayMonth(c.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="py-6 text-[15px] leading-7 text-gray-800">{card.summary}</p>

        {/* ── Criteria ─────────────────────────────────────────── */}
        <Eyebrow>Criteria</Eyebrow>
        <ol className="divide-y divide-[#eceae5] border-y border-[#eceae5]">
          {card.criteria.flatMap((c, i) => {
            const row = <CriterionRow key={c.key} criterion={c} onTimestampClick={onTimestampClick} onFlag={onFlag} />
            if (i !== 2) return [row]
            return [
              <li key="commercial-outcome" className="py-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-xs font-semibold tabular-nums text-gray-400">03</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Commercial Outcome</p>
                      <p className="mt-0.5 text-xs text-gray-500">{card.commercial_outcome_note}</p>
                    </div>
                  </div>
                  <span className={`inline-flex flex-shrink-0 items-center self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ${card.declared_outcome ? OUTCOME_TONE[card.declared_outcome] : 'bg-stone-100 text-stone-700'}`}>
                    {card.commercial_outcome_label}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between sm:pl-8">
                  <p className="text-[10px] uppercase tracking-widest text-gray-400">Not scored</p>
                  {onFlag && (
                    <button
                      type="button"
                      onClick={() => onFlag(null, 'Commercial Outcome', card.commercial_outcome_note)}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 transition-colors hover:text-[#a07530]"
                    >
                      <Flag size={10} /> Something not right here?
                    </button>
                  )}
                </div>
              </li>,
              row,
            ]
          })}
        </ol>

        {/* ── Scoreline recap ──────────────────────────────────── */}
        <Eyebrow className="mt-8">Scoreline</Eyebrow>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Execution score</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums text-gray-900">
              {pct === null ? '—' : `${pct}%`}
              {band && <span className={`ml-1.5 font-medium ${BAND_TONE[band.tone].text}`}>· {band.label}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Commercial outcome</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">{card.commercial_outcome_label}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-7 text-gray-800"><span className="font-semibold text-gray-900">Report summary. </span>{card.report_summary}</p>

        {/* ── Deeper analysis ──────────────────────────────────── */}
        <Eyebrow className="mt-10">Deeper analysis and feedback</Eyebrow>

        <h3 className="text-sm font-semibold text-gray-900">Objections &amp; handling</h3>
        {card.objections.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No objections or hesitations were raised in the transcript.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {card.objections.map((o, i) => (
              <div key={i} className="border-l-2 border-[#e5e3df] pl-5">
                <div className="flex items-start gap-2.5">
                  <Quote size={15} className="mt-1 flex-shrink-0 text-[#a07530]" />
                  <p className="text-sm font-medium leading-6 text-gray-900">{o.objection}</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-800"><span className="font-semibold text-gray-900">How you handled it. </span>{o.handled}</p>
                {(o.original_wording || o.trc_improved_response) && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {o.original_wording && (
                      <div className="rounded-lg bg-[#faf9f7] p-3.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Original</p>
                        <p className="mt-1.5 text-sm italic leading-6 text-gray-600">{o.original_wording}</p>
                      </div>
                    )}
                    {o.trc_improved_response && (
                      <div className="rounded-lg bg-[#fbf7ed] p-3.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a07530]">TRC doctrine</p>
                        <p className="mt-1.5 text-sm leading-6 text-gray-800">{o.trc_improved_response}</p>
                      </div>
                    )}
                  </div>
                )}
                {o.principle && <p className="mt-2.5 text-xs leading-5 text-gray-500"><span className="font-semibold text-gray-700">Relevant principle. </span>{o.principle}</p>}
              </div>
            ))}
          </div>
        )}

        {card.deeper_analysis.map((s, i) => (
          <div key={i} className="mt-7">
            <h3 className="text-sm font-semibold text-gray-900">{titleCase(s.heading)}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-800">{s.body}</p>
          </div>
        ))}

        <div className="my-8 rounded-xl border border-[#c8973f]/40 bg-[#fffdf8] p-5">
          <div className="flex items-center gap-2">
            <MessageCircleQuestion size={15} className="text-[#a07530]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">Final coaching question</p>
          </div>
          <p className="mt-2.5 text-[15px] leading-7 text-gray-900">{card.coaching_question}</p>
          {onDiscussCoachingQuestion && (
            <button
              type="button"
              onClick={onDiscussCoachingQuestion}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-black px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-900"
            >
              <MessageSquare size={13} /> Discuss this with your coach
            </button>
          )}
        </div>
      </div>

      <footer className="border-t border-[#eceae5] px-6 py-3 text-center text-[11px] text-gray-400 sm:px-12">
        {meta.generatedAt ? `Generated ${formatDayMonthYearTime(meta.generatedAt)}` : ''}
        {meta.modelUsed ? ` · ${meta.modelUsed}` : ''}
        {' · Evidence quoted verbatim from the transcript'}
      </footer>
    </article>
  )
}

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-gray-400 ${className}`}>{children}</p>
}

function CriterionRow({ criterion: c, onTimestampClick, onFlag }: { criterion: SalesCoachCriterion; onTimestampClick?: (ms: number) => void; onFlag?: FlagHandler }) {
  const style = VERDICT[c.verdict]
  const meta = SALES_COACH_CRITERIA.find((k) => k.key === c.key)
  const label = meta?.label || c.label
  const aiSaid = c.evidence?.[0]?.text || c.reason || c.note || ''
  return (
    <li id={`criterion-${c.key}`} className="scroll-mt-24 py-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex items-baseline gap-2.5">
          <span className="text-xs font-semibold tabular-nums text-gray-400">{String(meta?.number ?? 0).padStart(2, '0')}</span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{label}</p>
            {c.note && <p className="mt-0.5 text-xs text-gray-500">{c.note}</p>}
          </div>
        </div>
        <span className={`inline-flex flex-shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${style.chip}`}>
          {style.icon}{style.label}
        </span>
      </div>
      {(c.evidence?.length || c.reason) && (
        <div className="mt-3 flex flex-col gap-2 sm:pl-8">
          {c.evidence?.map((e, i) => (
            <div key={i} className="border-l-2 border-[#c8973f]/60 pl-3.5">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{e.label}</p>
                {e.time_ms !== undefined && onTimestampClick && (
                  <button
                    type="button"
                    onClick={() => onTimestampClick(e.time_ms!)}
                    title="Play from here"
                    className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums text-gray-500 ring-1 ring-[#e5e3df] transition-colors hover:bg-black hover:text-white hover:ring-black"
                  >
                    <Play size={8} className="fill-current" />{formatTimestamp(e.time_ms)}
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-sm italic leading-6 text-gray-700">{e.text}</p>
            </div>
          ))}
          {c.reason && <p className="text-sm leading-6 text-gray-800"><span className="font-semibold text-gray-900">Reason. </span>{c.reason}</p>}
        </div>
      )}
      {onFlag && (c.scored || c.verdict === 'uv') && (
        <button
          type="button"
          onClick={() => onFlag(c.key, label, aiSaid)}
          className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 transition-colors hover:text-[#a07530] sm:pl-8"
        >
          <Flag size={10} /> {c.verdict === 'uv' ? 'Tell the coach what happened' : 'Something not right here?'}
        </button>
      )}
    </li>
  )
}

const SEGMENT: Record<SalesCoachVerdict, string> = {
  pass: 'bg-emerald-500',
  warn: 'bg-amber-400',
  fail: 'bg-red-400',
  na: 'bg-stone-200',
  uv: 'bg-sky-200',
}

function criterionLabel(c: SalesCoachCriterion): string {
  return SALES_COACH_CRITERIA.find((k) => k.key === c.key)?.label || c.label
}

// Jump from the score breakdown / focus list to that criterion's evidence,
// with a brief highlight so the eye lands on the right row.
function scrollToCriterion(key: string) {
  const el = document.getElementById(`criterion-${key}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.add('bg-[#fffdf8]')
  setTimeout(() => el.classList.remove('bg-[#fffdf8]'), 1600)
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())
}
