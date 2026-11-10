'use client'

import { useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, HelpCircle, Quote, MessageCircleQuestion, Play, Flag, MessageSquare, Target, Compass, ChevronDown, Send } from 'lucide-react'
import {
  SALES_COACH_CRITERIA, SALES_COACH_TRACKS, SHOW_SCORE_POINTS, VERDICT_RATING, commercialOutcomeType, criterionDisplayNumber, evidenceLabel,
  followUpAssessment, formatOverallScore, formatTimestamp, meetingLabel, outcomeLabel, reportCardSections, scoreBand,
  scorePercent, titleCaseHeading, unverifiedNote, type ReportCardSectionId,
} from '@/lib/sales-coach'
import { BAND_TONE, ScoreRing } from '@/components/sales-coach/ScoreDisplay'
import { formatDayMonthYearTime, formatDayMonth } from '@/lib/date-format'
import type {
  SalesCoachReportCard, SalesCoachCriterion, SalesCoachVerdict, SalesCoachOutcome, SalesCoachCorrection,
  SalesCoachCardPoint, SalesCoachTrack, SalesCoachEvidence,
} from '@/types'

// The Report Card as ONE document: TRC SALES COACH — REPORT CARD / Company /
// Meeting / Outcome, then the sections in the order of reportCardSections():
// A. Execution Scorecard FIRST and always open (CEO, 10 Nov 2026: "first
// thing they see, not the last") — a compact list of the ratings the Detailed
// Performance Assessment gives, never a second assessment; B. Negotiation
// Result and C. Follow-Up Assessment & Recommended Actions open; D. What You
// Did Well / Main Areas for Improvement, E. Detailed Performance Assessment
// and F. Deeper Coaching collapsed until opened (CEO's 4 Nov 2026 brief). The
// score is a percentage only, for everyone: no "3.5/8 applicable points" and
// no "(0.5)" per criterion (SHOW_SCORE_POINTS). The content of every section is unchanged from the Oct 2026
// sample-card layout; only the order, the collapsing and the points are new.
// renderReportCardMarkdown() is the text twin of this view; both read the same
// object. Cards generated before Oct 2026 have no strengths/improvements/
// commercial reality; those sections are simply left out.

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
  onAskCoach,
  showPoints = false,
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
  // "Ask the coach anything" (end of Deeper Coaching): sends the question to
  // the existing coaching chat, which already has all five TRC documents.
  onAskCoach?: (question: string) => void
  // Admins would see the score's points as well as the percentage, but only
  // while SHOW_SCORE_POINTS is on; it's off, so everyone sees the percentage.
  showPoints?: boolean
}) {
  const pct = scorePercent(card.execution_score, card.execution_denominator)
  const band = scoreBand(pct)
  const uvNote = unverifiedNote(card.criteria)
  const outcomeType = commercialOutcomeType(card.declared_outcome)
  const outcomeChip = card.declared_outcome ? OUTCOME_TONE[card.declared_outcome] : 'bg-stone-100 text-stone-700'
  const meeting = card.meeting || meetingLabel(meta.interviewee)
  const hasNewLayout = Array.isArray(card.strengths)
  const title = Object.fromEntries(reportCardSections(card).map((s) => [s.id, s.title])) as Partial<Record<ReportCardSectionId, string>>
  const followUp = followUpAssessment(card)
  const strengths = card.strengths || []
  const improvements = card.improvements || []

  // What You Did Well, Detailed Performance Assessment and Deeper Coaching
  // start collapsed; the scorecard, result and follow-up are always open.
  const [open, setOpen] = useState({ review: false, detail: false, coaching: false })
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  // A scorecard row opens the Detailed Performance Assessment and jumps to that
  // criterion's evidence.
  function openCriterion(key: string) {
    setOpen((o) => ({ ...o, detail: true }))
    setTimeout(() => scrollToCriterion(key), 60)
  }

  const objectionsHint = card.objections.length === 0
    ? 'No objections raised'
    : `${card.objections.length} ${card.objections.length === 1 ? 'objection' : 'objections'} and how to handle ${card.objections.length === 1 ? 'it' : 'them'}`
  const subline = [
    [meta.publication, meta.country].filter(Boolean).join(' · '),
    `Negotiation of ${new Date(meta.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    meta.submittedBy ? `Submitted by ${meta.submittedBy}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <article className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
      {/* ── Header: Company / Meeting / Outcome ──────────────────── */}
      <header className="px-4 pb-5 pt-6 sm:px-12 sm:pb-6 sm:pt-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#a07530]">TRC Sales Coach — Report Card</p>
        <dl className="mt-4 grid grid-cols-[auto,minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-sm sm:gap-x-5">
          <dt className="text-xs font-medium text-gray-400">Company</dt>
          <dd className="text-lg font-semibold tracking-tight text-gray-900">{meta.company || card.company || 'Unclear from filename'}</dd>
          <dt className="text-xs font-medium text-gray-400">Meeting</dt>
          <dd className="text-gray-800">{meeting}</dd>
          <dt className="text-xs font-medium text-gray-400">Outcome</dt>
          <dd><span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${outcomeChip}`}>{outcomeType}</span></dd>
        </dl>
        <p className="mt-4 text-xs text-gray-400">{subline}</p>
      </header>

      <div className="px-4 sm:px-12">
        {/* ── A. Execution Scorecard (open, always first) ───────── */}
        {/* The first thing read (CEO, 10 Nov 2026). A compact summary of the
            ratings the Detailed Performance Assessment gives, row for row —
            never a second assessment. Each row opens that section at the
            criterion. Points only for admins; everyone sees the percentage. */}
        <Section title={title.scorecard!}>
          <div className="rounded-xl bg-[#faf9f7] px-4 py-5 sm:px-6 sm:py-6">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
              <ScoreRing pct={pct} size={96} />
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="text-base font-semibold tabular-nums text-gray-900">Overall Execution Score: {formatOverallScore(card, { showPoints })}</p>
                {band ? (
                  <p className={`mt-1 text-sm font-semibold ${BAND_TONE[band.tone].text}`}>{band.label}</p>
                ) : (
                  <p className="mt-1 text-sm leading-6 text-gray-600">There wasn&apos;t enough verifiable material in the recording to calculate a score.</p>
                )}
                {uvNote && (
                  <p className="mt-1.5 flex items-start justify-center gap-1.5 text-xs leading-5 text-gray-500 sm:justify-start">
                    <HelpCircle size={12} className="mt-0.5 flex-shrink-0 text-sky-500" />
                    {uvNote}
                  </p>
                )}
              </div>
            </div>

            <ul className="mt-5 divide-y divide-[#e9e7e2] border-t border-[#e9e7e2]">
              {card.criteria.map((c) => {
                const number = criterionDisplayNumber(c.key)
                const style = VERDICT[c.verdict]
                return (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => openCriterion(c.key)}
                      className="group flex w-full items-center justify-between gap-3 py-2.5 touch:py-3.5 text-left"
                    >
                      <span className="min-w-0 text-sm text-gray-800 transition-colors group-hover:text-black">
                        {number && <span className="mr-1.5 tabular-nums text-gray-400">{number}</span>}
                        {criterionLabel(c)}
                      </span>
                      <span className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${style.chip}`}>
                        {style.icon}{SCORECARD_RATING[c.verdict]}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-xs leading-5 text-gray-500">
              {SHOW_SCORE_POINTS
                ? '✅ Strong = 1, ⚠️ Partial = 0.5, ❌ Weak = 0, each criterion weighted equally.'
                : 'Every criterion counts equally: Strong counts in full, Partial counts half, Weak counts nothing.'}{' '}
              N/A (not applicable) and UV (couldn&apos;t be verified from the audio) are left out, and Commercial Outcome is never scored. Select a criterion to see its evidence.
            </p>
          </div>
        </Section>

        {/* ── B. Negotiation Result (open) ──────────────────────── */}
        <Section title={title.result!}>
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

        {/* ── C. Follow-Up Assessment (open) ────────────────────── */}
        {followUp && title.follow_up && (
          <Section title={title.follow_up}>
            {followUp.rows.length > 0 && (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Where it stands</p>
                <dl className="mt-3 flex flex-col gap-3">
                  {followUp.rows.map((r) => (
                    <div key={r.key} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[11rem,minmax(0,1fr)] sm:gap-5">
                      <dt className="text-sm font-semibold text-gray-900">{r.label}</dt>
                      <dd className="text-sm leading-6 text-gray-700">{r.text}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {followUp.nextStep && (
              <div className={`${followUp.rows.length > 0 ? 'mt-5' : ''} rounded-xl bg-[#fbf7ed] px-4 py-3.5`}>
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">
                  <Compass size={12} /> Recommended next step
                </p>
                <p className="mt-1.5 text-sm leading-6 text-gray-900">{followUp.nextStep}</p>
              </div>
            )}
            {onChooseTrack && (
              <button
                type="button"
                onClick={() => onChooseTrack('commercial')}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2 touch:py-3 text-xs font-medium text-gray-800 transition-colors hover:border-gray-400"
              >
                <MessageSquare size={13} /> Work on the next steps with your coach
              </button>
            )}
          </Section>
        )}

        {/* ── D. What You Did Well / Main Areas for Improvement ── */}
        {title.review && (
          <Collapsible
            title={title.review}
            hint={`${plural(strengths.length, 'strength')} · ${plural(improvements.length, 'area', 'areas')} for improvement`}
            open={open.review}
            onToggle={() => toggle('review')}
          >
            <h4 className="mb-3 text-sm font-semibold text-gray-900">What You Did Well</h4>
            <PointList items={card.strengths} empty="No strengths could be grounded in the transcript evidence." marker="bg-emerald-50 text-emerald-700" />
            <h4 className="mb-3 mt-7 text-sm font-semibold text-gray-900">Main Areas for Improvement</h4>
            <PointList items={card.improvements} empty="No material controllable improvements were identified." marker="bg-amber-50 text-amber-700" />
          </Collapsible>
        )}

        {/* ── E. Detailed Performance Assessment (collapsed) ────── */}
        <Collapsible
          title={title.detail!}
          hint="Each criterion with the evidence, the assessment and better wording"
          open={open.detail}
          onToggle={() => toggle('detail')}
        >
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
                      className="mt-2.5 inline-flex items-center gap-1 touch:py-2.5 text-[10px] font-medium text-gray-400 transition-colors hover:text-[#a07530]"
                    >
                      <Flag size={10} /> Something not right here?
                    </button>
                  )}
                </li>,
                row,
              ]
            })}
          </ol>
        </Collapsible>

        {/* ── F. Deeper Coaching (collapsed) ────────────────────── */}
        <Collapsible
          title={title.coaching!}
          hint={`${objectionsHint} · your coaching question${onAskCoach ? ' · ask the coach anything' : ''}`}
          open={open.coaching}
          onToggle={() => toggle('coaching')}
        >
          <h4 className="text-sm font-semibold text-gray-900">Objections and Handling</h4>
          {card.objections.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No genuine objections were raised in the transcript.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {card.objections.map((o, i) => (
                <div key={i} className="border-l-2 border-[#e5e3df] pl-3 sm:pl-5">
                  <div className="flex items-start gap-2.5">
                    <Quote size={15} className="mt-1 flex-shrink-0 text-[#a07530]" />
                    <p className="text-sm font-medium leading-6 text-gray-900">{o.objection}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-gray-800"><span className="font-semibold text-gray-900">How you handled it: </span>{o.handled}</p>
                  {(o.original_wording || o.trc_improved_response) && (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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

          <div className="mt-8 rounded-xl border border-[#c8973f]/40 bg-[#fffdf8] p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <MessageCircleQuestion size={15} className="text-[#a07530]" />
              <p className="text-sm font-semibold text-gray-900">Final Coaching Question</p>
            </div>
            <p className="mt-2.5 text-[15px] leading-7 text-gray-900">{card.coaching_question}</p>
            {onDiscussCoachingQuestion && (
              <button
                type="button"
                onClick={onDiscussCoachingQuestion}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2 touch:py-3 text-xs font-medium text-gray-800 transition-colors hover:border-gray-400"
              >
                <MessageSquare size={13} /> Answer this with your coach
              </button>
            )}
          </div>

          {/* Two-track invitation. */}
          {(card.coaching_invitation || onChooseTrack) && (
            <div className="mt-4 rounded-xl bg-[#faf9f7] p-4 sm:p-5">
              <p className="text-sm font-semibold text-gray-900">Continue With Your Coach</p>
              <p className="mt-2 text-sm leading-7 text-gray-800">
                {card.coaching_invitation || 'You can practise the most important improvement from this meeting, or work on the next commercial action for this opportunity. Which would help you most right now?'}
              </p>
              {onChooseTrack && (
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <TrackButton icon={<Target size={15} />} track="execution" onClick={onChooseTrack} />
                  {/* The next step itself is in the Follow-Up Assessment, so it isn't repeated here. */}
                  <TrackButton icon={<Compass size={15} />} track="commercial" onClick={onChooseTrack} />
                </div>
              )}
            </div>
          )}

          {onAskCoach && <AskCoachBox onAsk={onAskCoach} />}
        </Collapsible>

      </div>

      <footer className="border-t border-[#eceae5] px-4 py-3 text-center text-[11px] text-gray-400 sm:px-12">
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

// A section that opens on demand. While closed, a one-line hint says what is
// inside, so nothing is hidden without a clue that it is there.
function Collapsible({ title, hint, open, onToggle, children }: {
  title: string
  hint: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-[#eceae5]">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="group flex w-full items-start justify-between gap-4 py-6 text-left"
        >
          <span className="min-w-0">
            <span className="block text-base font-semibold tracking-tight text-gray-900">{title}</span>
            {!open && <span className="mt-1 block text-xs leading-5 text-gray-500">{hint}</span>}
          </span>
          <span className="mt-0.5 inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-gray-500 transition-colors group-hover:text-black">
            {open ? 'Hide' : 'Show'}
            <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>
      </h3>
      {open && <div className="pb-7">{children}</div>}
    </section>
  )
}

// The CEO's brief (4 Nov 2026): "a big field where they can ask whatever they
// want and the AI can surface the materials that we have written/uploaded".
// The coaching chat already answers from all five TRC documents; this only
// makes the place to ask it obvious. The question goes to that same chat.
function AskCoachBox({ onAsk }: { onAsk: (question: string) => void }) {
  const [question, setQuestion] = useState('')
  const submit = () => {
    const q = question.trim()
    if (!q) return
    onAsk(q)
    setQuestion('')
  }
  return (
    <div className="mt-4 rounded-xl border border-[#c8973f]/40 bg-white p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <MessageSquare size={15} className="text-[#a07530]" /> Ask the Coach Anything
      </p>
      <p className="mt-1.5 text-xs leading-5 text-gray-500">
        About this negotiation, or about any part of the TRC method. The coach answers from TRC&apos;s own sales documents: the Overcoming Objections manual, the Sales Coaching Method, the negotiation examples and the follow-up playbook.
      </p>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
        rows={4}
        maxLength={4000}
        placeholder="For example: How do I deal with “It’s not my decision” type of objections?"
        className="mt-3 w-full resize-y rounded-xl border border-[#e5e3df] bg-white px-3.5 py-2.5 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-400"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!question.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 touch:py-3 text-xs font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-40"
        >
          <Send size={13} /> Ask the coach
        </button>
      </div>
    </div>
  )
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
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
      className="mr-1.5 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 touch:px-3 touch:py-1.5 align-[1px] font-mono text-[10px] font-medium not-italic tabular-nums text-gray-500 ring-1 ring-[#e5e3df] transition-colors hover:bg-black hover:text-white hover:ring-black"
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
          className="mt-2.5 inline-flex items-center gap-1 touch:py-2.5 text-[10px] font-medium text-gray-400 transition-colors hover:text-[#a07530]"
        >
          <Flag size={10} /> {c.verdict === 'uv' ? 'Tell the coach what happened' : 'Something not right here?'}
        </button>
      )}
    </li>
  )
}

// The scorecard's chips are short; its legend spells out N/A and UV.
const SCORECARD_RATING: Record<SalesCoachVerdict, string> = {
  pass: VERDICT_RATING.pass,
  warn: VERDICT_RATING.warn,
  fail: VERDICT_RATING.fail,
  na: 'N/A',
  uv: 'UV',
}

function criterionLabel(c: SalesCoachCriterion): string {
  return SALES_COACH_CRITERIA.find((k) => k.key === c.key)?.label || c.label
}

// Jump from a scorecard row to that criterion's evidence in D, with a brief
// highlight so the eye lands on the right row.
function scrollToCriterion(key: string) {
  const el = document.getElementById(`criterion-${key}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.add('bg-[#fffdf8]')
  setTimeout(() => el.classList.remove('bg-[#fffdf8]'), 1600)
}
