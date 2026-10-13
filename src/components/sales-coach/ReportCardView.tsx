'use client'

import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, HelpCircle, Quote, MessageCircleQuestion, Play, Flag, MessageSquare, ArrowUp, TrendingUp, Target, Compass } from 'lucide-react'
import {
  SALES_COACH_CRITERIA, SALES_COACH_TRACKS, VERDICT_RATING, commercialOutcomeType, evidenceLabel, formatOverallScore,
  formatTimestamp, meetingLabel, outcomeLabel, scoreBand, scoreOpportunities, scorePercent, titleCaseHeading, unverifiedNote,
} from '@/lib/sales-coach'
import { BAND_TONE, ScoreRing } from '@/components/sales-coach/ScoreDisplay'
import { formatDayMonthYearTime, formatDayMonth } from '@/lib/date-format'
import type {
  SalesCoachReportCard, SalesCoachCriterion, SalesCoachVerdict, SalesCoachOutcome, SalesCoachCorrection,
  SalesCoachCardPoint, SalesCoachTrack, SalesCoachEvidence,
} from '@/types'

// The Report Card as ONE document, laid out exactly like the client's sample
// card (Oct 2026): TRC SALES COACH — REPORT CARD / Company / Meeting /
// Outcome → A. Negotiation Result → B. What You Did Well → C. Main Areas for
// Improvement → D. Detailed Performance Assessment ("1. Sales Offer Buildup —
// ✅ Strong (1)" with Evidence / Assessment / Commercial reality / Better
// approach; 3 = Commercial Outcome — NOT SCORED) → E. Deeper Coaching (the one
// reflective question, then the two-track invitation) → F. Overall Execution
// Score, LAST — no score appears anywhere above it. renderReportCardMarkdown()
// is the text twin of this view; both read the same object. Cards generated
// before this layout have no strengths/improvements/commercial reality; those
// parts are simply left out.

const VERDICT: Record<SalesCoachVerdict, { chip: string; icon: React.ReactNode }> = {
  pass: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: <CheckCircle2 size={13} /> },
  warn: { chip: 'bg-amber-50 text-amber-700 ring-amber-200', icon: <AlertTriangle size={13} /> },
  fail: { chip: 'bg-red-50 text-red-700 ring-red-200', icon: <XCircle size={13} /> },
  na: { chip: 'bg-stone-100 text-stone-600 ring-stone-200', icon: <MinusCircle size={13} /> },
  uv: { chip: 'bg-sky-50 text-sky-700 ring-sky-200', icon: <HelpCircle size={13} /> },
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
  onChooseTrack,
}: {
  card: SalesCoachReportCard
  meta: ReportCardMeta
  onTimestampClick?: (ms: number) => void
  corrections?: SalesCoachCorrection[]
  onFlag?: FlagHandler
  onDiscussCoachingQuestion?: () => void
  // The two-track invitation at the end of Deeper Coaching: open the coaching
  // chat on either track. Both are offered for every outcome.
  onChooseTrack?: (track: SalesCoachTrack) => void
}) {
  const scored = card.criteria.filter((c) => c.scored)
  const count = (v: SalesCoachVerdict) => scored.filter((c) => c.verdict === v).length
  const pct = scorePercent(card.execution_score, card.execution_denominator)
  const band = scoreBand(pct)
  const focus = scoreOpportunities(card).slice(0, 2)
  const landed = scored.filter((c) => c.verdict === 'pass').map(criterionLabel)
  const uvNote = unverifiedNote(card.criteria)
  const outcomeType = commercialOutcomeType(card.declared_outcome)
  const outcomeChip = card.declared_outcome ? OUTCOME_TONE[card.declared_outcome] : 'bg-stone-100 text-stone-700'
  const hasNewLayout = Array.isArray(card.strengths)
  const meeting = card.meeting || meetingLabel(meta.interviewee)
  const subline = [
    [meta.publication, meta.country].filter(Boolean).join(' · '),
    `Negotiation of ${new Date(meta.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    meta.submittedBy ? `Submitted by ${meta.submittedBy}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <article className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
      {/* ── Header: Company / Meeting / Outcome ──────────────────── */}
      <header className="px-6 pb-6 pt-8 sm:px-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#a07530]">TRC Sales Coach — Report Card</p>
        <dl className="mt-4 grid grid-cols-[auto,1fr] items-baseline gap-x-5 gap-y-2 text-sm">
          <dt className="text-xs font-medium text-gray-400">Company</dt>
          <dd className="text-lg font-semibold tracking-tight text-gray-900">{meta.company || card.company || 'Unclear from filename'}</dd>
          <dt className="text-xs font-medium text-gray-400">Meeting</dt>
          <dd className="text-gray-800">{meeting}</dd>
          <dt className="text-xs font-medium text-gray-400">Outcome</dt>
          <dd><span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${outcomeChip}`}>{outcomeType}</span></dd>
        </dl>
        <p className="mt-4 text-xs text-gray-400">{subline}</p>
      </header>

      <div className="px-6 sm:px-12">
        {/* ── A. Negotiation Result ─────────────────────────────── */}
        <Section title="A. Negotiation Result">
          {hasNewLayout ? (
            <p className="text-[15px] font-semibold leading-relaxed text-gray-900">{outcomeType} — {card.headline}</p>
          ) : (
            <>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${outcomeChip}`}>{card.commercial_outcome_label}</span>
              <p className="mt-3 text-[15px] font-medium leading-relaxed text-gray-900">{card.headline}</p>
            </>
          )}
          <p className="mt-3 text-sm leading-7 text-gray-700">{card.summary}</p>
          {!hasNewLayout && card.report_summary && <p className="mt-3 text-sm leading-7 text-gray-700">{card.report_summary}</p>}

          {corrections.length > 0 && (
            <div className="mt-5 rounded-xl bg-[#faf9f7] p-4">
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
        </Section>

        {/* ── B / C ─────────────────────────────────────────────── */}
        {hasNewLayout && (
          <>
            <Section title="B. What You Did Well">
              <PointList items={card.strengths} empty="No strengths could be grounded in the transcript evidence." marker="bg-emerald-50 text-emerald-700" />
            </Section>
            <Section title="C. Main Areas for Improvement">
              <PointList items={card.improvements} empty="No material controllable improvements were identified." marker="bg-amber-50 text-amber-700" />
            </Section>
          </>
        )}

        {/* ── D. Detailed Performance Assessment ────────────────── */}
        <Section title="D. Detailed Performance Assessment">
          <ol className="divide-y divide-[#eceae5]">
            {card.criteria.flatMap((c, i) => {
              const row = <CriterionRow key={c.key} criterion={c} onTimestampClick={onTimestampClick} onFlag={onFlag} />
              if (i !== 2) return [row]
              return [
                <li key="commercial-outcome" className="py-5">
                  <p className="text-sm font-semibold text-gray-900">3. Commercial Outcome — NOT SCORED</p>
                  {card.commercial_outcome_summary ? (
                    <p className="mt-2 text-sm leading-6 text-gray-800">{outcomeLabel(card.declared_outcome)}. {card.commercial_outcome_summary}</p>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-gray-800">
                      <span className={`mr-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${outcomeChip}`}>{card.commercial_outcome_label}</span>
                      {card.commercial_outcome_note}
                    </p>
                  )}
                  {onFlag && (
                    <button
                      type="button"
                      onClick={() => onFlag(null, 'Commercial Outcome', card.commercial_outcome_summary || card.commercial_outcome_note)}
                      className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 transition-colors hover:text-[#a07530]"
                    >
                      <Flag size={10} /> Something not right here?
                    </button>
                  )}
                </li>,
                row,
              ]
            })}
          </ol>
        </Section>

        {/* ── E. Deeper Coaching ────────────────────────────────── */}
        <Section title="E. Deeper Coaching">
          <h4 className="text-sm font-semibold text-gray-900">Objections and Handling</h4>
          {card.objections.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No genuine objections were raised in the transcript.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {card.objections.map((o, i) => (
                <div key={i} className="border-l-2 border-[#e5e3df] pl-5">
                  <div className="flex items-start gap-2.5">
                    <Quote size={15} className="mt-1 flex-shrink-0 text-[#a07530]" />
                    <p className="text-sm font-medium leading-6 text-gray-900">{o.objection}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-800"><span className="font-semibold text-gray-900">How you handled it: </span>{o.handled}</p>
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
                  {o.principle && <p className="mt-2.5 text-xs leading-5 text-gray-500"><span className="font-semibold text-gray-700">Relevant principle: </span>{o.principle}</p>}
                </div>
              ))}
            </div>
          )}

          {card.deeper_analysis.map((s, i) => (
            <div key={i} className="mt-7">
              <h4 className="text-sm font-semibold text-gray-900">{titleCaseHeading(s.heading)}</h4>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-800">{s.body}</p>
            </div>
          ))}

          <div className="mt-8 rounded-xl border border-[#c8973f]/40 bg-[#fffdf8] p-5">
            <div className="flex items-center gap-2">
              <MessageCircleQuestion size={15} className="text-[#a07530]" />
              <p className="text-sm font-semibold text-gray-900">Final Coaching Question</p>
            </div>
            <p className="mt-2.5 text-[15px] leading-7 text-gray-900">{card.coaching_question}</p>
            {onDiscussCoachingQuestion && (
              <button
                type="button"
                onClick={onDiscussCoachingQuestion}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2 text-xs font-medium text-gray-800 transition-colors hover:border-gray-400"
              >
                <MessageSquare size={13} /> Answer this with your coach
              </button>
            )}
          </div>

          {/* Two-track invitation — immediately before the score. */}
          {(card.coaching_invitation || onChooseTrack) && (
            <div className="mt-4 rounded-xl bg-[#faf9f7] p-5">
              <p className="text-sm font-semibold text-gray-900">Continue With Your Coach</p>
              <p className="mt-2 text-sm leading-7 text-gray-800">
                {card.coaching_invitation || 'You can practise the most important improvement from this meeting, or work on the next commercial action for this opportunity. Which would help you most right now?'}
              </p>
              {onChooseTrack && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <TrackButton icon={<Target size={15} />} track="execution" onClick={onChooseTrack} />
                  <TrackButton icon={<Compass size={15} />} track="commercial" onClick={onChooseTrack} sub={card.next_commercial_priority} />
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── F. Overall Execution Score — always last ──────────── */}
        <Section title="F. Overall Execution Score">
          <div className="rounded-xl bg-[#faf9f7] px-6 py-6">
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
              <ScoreRing pct={pct} />
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="text-base font-semibold tabular-nums text-gray-900">Overall Execution Score: {formatOverallScore(card)}</p>
                {band ? (
                  <>
                    <p className={`mt-1 text-sm font-semibold ${BAND_TONE[band.tone].text}`}>{band.label}</p>
                    <p className="mt-1 text-sm leading-6 text-gray-600">{band.hint}</p>
                  </>
                ) : (
                  <p className="mt-1 text-sm leading-6 text-gray-600">There wasn&apos;t enough verifiable material in the recording to calculate a score.</p>
                )}
                <p className="mt-2 text-xs leading-5 text-gray-500">
                  Every applicable criterion carries equal weight: ✅ Strong = 1, ⚠️ Partial = 0.5, ❌ Weak = 0. N/A and UV are left out, and Commercial Outcome is never scored.
                </p>
              </div>
            </div>

            {scored.length > 0 && (
              <div className="mt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">How your score breaks down</p>
                  <p className="whitespace-nowrap text-[11px] text-gray-500">
                    {[count('pass') && `${count('pass')} strong`, count('warn') && `${count('warn')} partial`, count('fail') && `${count('fail')} weak`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="mt-2 flex gap-1">
                  {scored.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => scrollToCriterion(c.key)}
                      title={`${criterionLabel(c)} — ${VERDICT_RATING[c.verdict]}`}
                      className={`h-2.5 flex-1 rounded-full transition-opacity hover:opacity-70 ${SEGMENT[c.verdict]}`}
                    />
                  ))}
                </div>
                {landed.length > 0 && (
                  <p className="mt-3 text-xs leading-5 text-gray-600">
                    <span className="font-semibold text-emerald-700">What landed: </span>
                    {landed.join(', ')}
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

            {focus.length > 0 && (
              <div className="mt-5 border-t border-[#e9e7e2] pt-4">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">
                  <TrendingUp size={12} /> Where the points went
                </p>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {focus.map((f) => (
                    <li key={f.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <p className="text-sm text-gray-800">
                        <span className="font-semibold text-gray-900">{f.label}</span>
                        <span className={`ml-2 text-xs font-medium ${f.verdict === 'fail' ? 'text-red-700' : 'text-amber-700'}`}>
                          {f.verdict === 'fail' ? 'Weak' : 'Partial'}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500">Getting this fully right would take you to {f.reachPct}%.</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => scrollToCriterion(f.key)}
                        className="inline-flex flex-shrink-0 items-center gap-1 self-start text-xs font-medium text-gray-600 transition-colors hover:text-black sm:self-center"
                      >
                        See the evidence <ArrowUp size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      </div>

      <footer className="border-t border-[#eceae5] px-6 py-3 text-center text-[11px] text-gray-400 sm:px-12">
        {meta.generatedAt ? `Generated ${formatDayMonthYearTime(meta.generatedAt)}` : ''}
        {meta.modelUsed ? ` · ${meta.modelUsed}` : ''}
        {' · Evidence quoted verbatim from the transcript'}
      </footer>
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[#eceae5] py-7">
      <h3 className="mb-4 text-base font-semibold tracking-tight text-gray-900">{title}</h3>
      {children}
    </section>
  )
}

function PointList({ items, empty, marker }: { items?: SalesCoachCardPoint[]; empty: string; marker: string }) {
  if (!items || items.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <ol className="flex flex-col gap-3">
      {items.map((p, i) => (
        <li key={i} className="flex gap-3">
          <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${marker}`}>{i + 1}</span>
          <p className="text-sm leading-6 text-gray-800">
            <span className="font-semibold text-gray-900">{p.title.replace(/\.$/, '')}. </span>
            {p.detail}
          </p>
        </li>
      ))}
    </ol>
  )
}

function TrackButton({ icon, track, onClick, sub }: { icon: React.ReactNode; track: SalesCoachTrack; onClick: (t: SalesCoachTrack) => void; sub?: string }) {
  const t = SALES_COACH_TRACKS[track]
  return (
    <button
      type="button"
      onClick={() => onClick(track)}
      className="flex items-start gap-3 rounded-lg border border-[#e5e3df] bg-white px-4 py-3 text-left transition-colors hover:border-[#c8973f]/60 hover:bg-[#fffdf8]"
    >
      <span className="mt-0.5 text-[#a07530]">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">{t.label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-gray-500">{sub || t.hint}</span>
      </span>
    </button>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-sm leading-6 text-gray-800">
      <span className="font-semibold text-gray-900">{label}: </span>
      {children}
    </p>
  )
}

function TimestampButton({ ms, onClick }: { ms: number; onClick: (ms: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(ms)}
      title="Play from here"
      className="mr-1.5 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 align-[1px] font-mono text-[10px] font-medium not-italic tabular-nums text-gray-500 ring-1 ring-[#e5e3df] transition-colors hover:bg-black hover:text-white hover:ring-black"
    >
      <Play size={8} className="fill-current" />{formatTimestamp(ms)}
    </button>
  )
}

function EvidenceItem({ e, onTimestampClick }: { e: SalesCoachEvidence; onTimestampClick?: (ms: number) => void }) {
  const label = evidenceLabel(e.label)
  return (
    <>
      {e.time_ms !== undefined && onTimestampClick && <TimestampButton ms={e.time_ms} onClick={onTimestampClick} />}
      {label && <span className="text-gray-500">{label}: </span>}
      <span className="italic text-gray-700">{e.text}</span>
    </>
  )
}

function EvidenceLines({ evidence, onTimestampClick }: { evidence?: SalesCoachEvidence[]; onTimestampClick?: (ms: number) => void }) {
  if (!evidence || evidence.length === 0) return null
  if (evidence.length === 1) {
    return (
      <p className="text-sm leading-6 text-gray-800">
        <span className="font-semibold text-gray-900">Evidence: </span>
        <EvidenceItem e={evidence[0]} onTimestampClick={onTimestampClick} />
      </p>
    )
  }
  return (
    <div className="text-sm leading-6 text-gray-800">
      <p className="font-semibold text-gray-900">Evidence:</p>
      <ul className="mt-1 flex flex-col gap-1 border-l-2 border-[#c8973f]/60 pl-3.5">
        {evidence.map((e, i) => (
          <li key={i}><EvidenceItem e={e} onTimestampClick={onTimestampClick} /></li>
        ))}
      </ul>
    </div>
  )
}

function CriterionRow({ criterion: c, onTimestampClick, onFlag }: { criterion: SalesCoachCriterion; onTimestampClick?: (ms: number) => void; onFlag?: FlagHandler }) {
  const style = VERDICT[c.verdict]
  const meta = SALES_COACH_CRITERIA.find((k) => k.key === c.key)
  const label = meta?.label || c.label
  const aiSaid = c.evidence?.[0]?.text || c.reason || c.note || ''
  return (
    <li id={`criterion-${c.key}`} className="scroll-mt-24 py-5 first:pt-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p className="text-sm font-semibold text-gray-900">{meta?.number ?? ''}. {label}</p>
        <span className={`inline-flex flex-shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${style.chip}`}>
          {style.icon}{VERDICT_RATING[c.verdict]}
        </span>
      </div>
      {c.note && <p className="mt-1 text-xs text-gray-500">{c.verdict === 'na' ? `Not applicable: ${c.note}` : c.note}</p>}
      <div className="mt-3 flex flex-col gap-2">
        <EvidenceLines evidence={c.evidence} onTimestampClick={onTimestampClick} />
        {c.reason && <Line label="Assessment">{c.reason}</Line>}
        {c.commercial_reality && <Line label="Commercial reality">{c.commercial_reality}</Line>}
        {c.better_approach && (
          <div className="rounded-lg bg-[#fbf7ed] px-3.5 py-2.5">
            <Line label="Better approach">{c.better_approach}</Line>
          </div>
        )}
      </div>
      {onFlag && (c.scored || c.verdict === 'uv') && (
        <button
          type="button"
          onClick={() => onFlag(c.key, label, aiSaid)}
          className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-medium text-gray-400 transition-colors hover:text-[#a07530]"
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

// Jump from the score breakdown / "where the points went" list to that
// criterion's evidence, with a brief highlight so the eye lands on the right row.
function scrollToCriterion(key: string) {
  const el = document.getElementById(`criterion-${key}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.add('bg-[#fffdf8]')
  setTimeout(() => el.classList.remove('bg-[#fffdf8]'), 1600)
}
