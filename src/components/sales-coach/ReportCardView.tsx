'use client'

import { useRef, useState } from 'react'
import {
  CheckCircle2, AlertTriangle, XCircle, MinusCircle, HelpCircle, Quote, MessageCircleQuestion, Play, Flag, MessageSquare,
  Target, Compass, ChevronDown, ChevronRight, ChevronUp, Send, TrendingUp, ArrowRight, BookOpen, RefreshCw, Loader2,
  Sparkles, AlertCircle,
} from 'lucide-react'
import { marked } from 'marked'
import {
  SALES_COACH_CRITERIA, SALES_COACH_TRACKS, SHOW_SCORE_POINTS, VERDICT_RATING, commercialOutcomeType, criterionDisplayNumber, evidenceLabel,
  followUpAssessment, followUpDisplayText, followUpSupportApplies, formatOverallScore, formatTimestamp, meetingLabel, outcomeLabel, reportCardSections, scoreBand,
  scorePercent, titleCaseHeading, unverifiedNote, type ReportCardSectionId,
} from '@/lib/sales-coach'
import { BAND_TONE, ScoreRing } from '@/components/sales-coach/ScoreDisplay'
import { formatDayMonthYearTime, formatDayMonth } from '@/lib/date-format'
import type {
  SalesCoachReportCard, SalesCoachCriterion, SalesCoachVerdict, SalesCoachOutcome, SalesCoachCorrection,
  SalesCoachCardPoint, SalesCoachTrack, SalesCoachEvidence,
} from '@/types'

// The Report Card on screen, in the order reportCardSections() gives: A.
// Negotiation Result under the title strip (Company · Meeting, Outcome tag top
// right; first again since 19 Nov 2026), then B. Execution Scorecard (first
// from 10 Nov to 19 Nov) — a compact list of the ratings the Detailed
// Performance Assessment gives, never a second assessment — and, per the 4 Nov
// brief, C. Follow-Up Assessment & Recommended Actions open; D. What You Did Well /
// Main Areas for Improvement, E. Detailed Performance Assessment and F. Deeper
// Coaching collapsed until opened. The score is a percentage only, for
// everyone (SHOW_SCORE_POINTS). Live Coach is no longer part of the card: since
// 20 Nov 2026 it is a floating button on every tab (LiveCoachFloating, mounted
// by NegotiationWorkspace). The content of every section is unchanged from the
// Oct 2026 sample-card layout. renderReportCardMarkdown() is the text twin of this
// view; both read the same object. Cards generated before Oct 2026 have no
// strengths/improvements/commercial reality; those sections are simply left
// out.
//
// This is the look the client approved (live 6–10 Nov 2026). On 9 Nov the file
// was overwritten by an older, plainer version, which is what shipped with the
// scorecard move on 10 Nov; it was restored from that deployment on 13 Nov.
// Keep this design.
//
// Look (6 Nov 2026, reworked the same day after review): every section is its
// own white card on the page's grey, so A and B can't run together. The
// "TRC SALES COACH — REPORT CARD" line and the Company / Meeting / Outcome form
// labels are gone from the screen (the page header above already names the
// company, people, publication and date); one title strip carries company ·
// meeting and the outcome badge. B's "Where it stands" lines are tiles, and the
// recommended next step is the card's one dark panel, with a large gold button
// into the coach's commercial track. Stone greys so the text sits with the
// gold, serif for the headline and the coaching question, running text held
// to ~80 characters. Collapsed sections lift on hover; an opened one fades in
// and has a second Hide at the bottom. The scorecard is a two-column panel
// from md up. The Word file and Copy as text keep the full TRC header.
// Presentation only: same words, same order.

const VERDICT: Record<SalesCoachVerdict, { chip: string; icon: React.ReactNode }> = {
  pass: { chip: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20', icon: <CheckCircle2 size={13} /> },
  warn: { chip: 'bg-amber-50 text-amber-800 ring-amber-600/25', icon: <AlertTriangle size={13} /> },
  fail: { chip: 'bg-rose-50 text-rose-800 ring-rose-600/20', icon: <XCircle size={13} /> },
  na: { chip: 'bg-stone-100 text-stone-600 ring-stone-500/20', icon: <MinusCircle size={13} /> },
  uv: { chip: 'bg-sky-50 text-sky-800 ring-sky-600/20', icon: <HelpCircle size={13} /> },
}

const OUTCOME_TONE: Record<SalesCoachOutcome, { chip: string; dot: string }> = {
  signed: { chip: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20', dot: 'bg-emerald-500' },
  retorno: { chip: 'bg-sky-50 text-sky-800 ring-sky-600/20', dot: 'bg-sky-500' },
  lost: { chip: 'bg-rose-50 text-rose-800 ring-rose-600/20', dot: 'bg-rose-500' },
  uncertain: { chip: 'bg-stone-100 text-stone-700 ring-stone-500/20', dot: 'bg-stone-400' },
}
const OUTCOME_NONE = { chip: 'bg-stone-100 text-stone-700 ring-stone-500/20', dot: 'bg-stone-400' }

// Small-caps labels used across the card.
const KICKER = 'text-[10.5px] font-semibold uppercase tracking-[0.16em] text-stone-500'
const KICKER_GOLD = 'text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#8f6626]'
const SUBHEAD = 'text-[15px] font-semibold tracking-[-0.01em] text-stone-900'
const NUMBER =
  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-stone-100 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-inset ring-stone-900/[0.06]'
const CHIP = 'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset'
// Running text stops at ~80 characters a line; boxes and tables keep the full width.
const MEASURE = 'max-w-[40rem]'
// Section A's headline and summary use the card's full width (20 Nov 2026: the
// old 46rem/40rem caps left a wide empty strip on the right of the card).
const HEADLINE =
  'text-pretty font-serif text-[19px] font-medium leading-[1.5] tracking-[-0.01em] text-stone-900 sm:text-[24px] sm:leading-[1.42]'
const HAIRLINE = 'border-[#ece9e3]'
const GOLD_PANEL = 'rounded-xl bg-[#fbf7ee] ring-1 ring-inset ring-[#c8973f]/25'
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8973f]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white'
// Each section is its own card on the page's grey, so no two sections run together.
const CARD =
  'rounded-2xl bg-white ring-1 ring-[#e6e2da] shadow-[0_1px_2px_rgba(28,25,23,0.04),0_14px_34px_-26px_rgba(28,25,23,0.28)]'
const CARD_BODY = 'px-5 py-6 sm:px-10 sm:py-8'
// D's rows reach a little past the text, so a row highlighted from the scorecard has room around it.
const CRITERION_ROW = '-mx-3 px-3 py-7 sm:-mx-4 sm:px-4'
const PRIMARY_BUTTON =
  `inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 touch:py-3 text-xs font-medium text-white shadow-[0_1px_2px_rgba(28,25,23,0.25)] transition hover:bg-black disabled:opacity-40 ${FOCUS}`

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
  onRequestFollowUp,
  followUpBusy = false,
  followUpError = null,
  canRegenerateFollowUp = false,
  playbookHref,
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
  // C. Follow-Up Decision Support (Rafa's prompt + playbook, its own call):
  // writes it, or rewrites it. Absent = no button (e.g. a read-only view).
  onRequestFollowUp?: () => void
  followUpBusy?: boolean
  followUpError?: string | null
  // Regenerate is for admins (Rafa testing prompt edits); everyone can get it
  // the first time on an older card.
  canRegenerateFollowUp?: boolean
  // The full playbook, read-only, for Sales Executives.
  playbookHref?: string
}) {
  const pct = scorePercent(card.execution_score, card.execution_denominator)
  const band = scoreBand(pct)
  const uvNote = unverifiedNote(card.criteria)
  const outcomeType = commercialOutcomeType(card.declared_outcome)
  const outcomeTone = card.declared_outcome ? OUTCOME_TONE[card.declared_outcome] : OUTCOME_NONE
  const meeting = card.meeting || meetingLabel(meta.interviewee)
  const hasNewLayout = Array.isArray(card.strengths)
  const title = Object.fromEntries(reportCardSections(card).map((s) => [s.id, s.title])) as Partial<Record<ReportCardSectionId, string>>
  const followUp = followUpAssessment(card)
  const support = card.follow_up_support?.text?.trim() || null
  const strengths = card.strengths || []
  const improvements = card.improvements || []

  // Review, Detail and Coaching start collapsed; Scorecard, Result and
  // Follow-Up are always open.
  const [open, setOpen] = useState({ review: false, detail: false, coaching: false })
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  // A scorecard row opens the Detailed Performance Assessment and jumps to
  // that criterion's evidence.
  function openCriterion(key: string) {
    setOpen((o) => ({ ...o, detail: true }))
    setTimeout(() => scrollToCriterion(key), 60)
  }

  const objectionsHint = card.objections.length === 0
    ? 'No objections raised'
    : `${card.objections.length} ${card.objections.length === 1 ? 'objection' : 'objections'} and how to handle ${card.objections.length === 1 ? 'it' : 'them'}`
  const company = meta.company || card.company || null

  return (
    <article className="flex flex-col gap-4 text-stone-900 antialiased selection:bg-[#f1e3c2] sm:gap-5">
      {/* ── A. Negotiation Result (open), under the card's title strip ── */}
      {/* First again since 19 Nov 2026, with the declared outcome tag at the
          top right of its strip, as before 10 Nov (CEO: "keep this so
          everyone stays focused on the result"). The headline below explains
          the result; the tag is the result. */}
      <section className={`${CARD} overflow-hidden`}>
        <div aria-hidden className="h-[3px] bg-gradient-to-r from-[#e6cf9c] via-[#b8862f] to-[#e6cf9c]" />
        <header className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 border-b ${HAIRLINE} bg-[#fbf9f5] px-5 py-3.5 sm:px-10`}>
          <p className="min-w-0 text-[13px] leading-5 text-stone-500">
            {company && <span className="block font-semibold text-stone-900 sm:inline">{company}</span>}
            {company && meeting && <span aria-hidden className="mx-2 hidden text-stone-300 sm:inline">·</span>}
            {meeting}
          </p>
          <OutcomeBadge tone={outcomeTone}>{outcomeType}</OutcomeBadge>
        </header>
        <div className={CARD_BODY}>
          <SectionHeading title={title.result!} />
          {hasNewLayout ? (
            <p className={`mt-6 ${HEADLINE}`}>
              <span className="sr-only">{outcomeType} — </span>{card.headline}
            </p>
          ) : (
            <>
              {/* Older cards carry their own outcome label ("Signed — full
                  page"); the title strip already shows the outcome type. */}
              {card.commercial_outcome_label && (
                <div className="mt-6"><OutcomeBadge tone={outcomeTone} large>{card.commercial_outcome_label}</OutcomeBadge></div>
              )}
              <p className={`${card.commercial_outcome_label ? 'mt-4' : 'mt-6'} ${HEADLINE}`}>{card.headline}</p>
            </>
          )}
          <p className="mt-5 text-pretty text-[15px] leading-[1.75] text-stone-600">{card.summary}</p>
          {!hasNewLayout && card.report_summary && <p className="mt-4 text-pretty text-[15px] leading-[1.75] text-stone-600">{card.report_summary}</p>}

          {corrections.length > 0 && (
            <div className="mt-7 rounded-xl bg-[#faf8f5] px-4 py-4 ring-1 ring-inset ring-[#ebe7e0] sm:px-5">
              <p className={`flex items-center gap-1.5 ${KICKER}`}>
                <Flag size={11} className="text-[#a07530]" /> Corrections on record
              </p>
              <ul className="mt-3 flex flex-col gap-3">
                {corrections.map((c) => (
                  <li key={c.id} className="text-sm leading-6 text-stone-700">
                    <span className="font-semibold text-stone-900">{c.field_label}. </span>
                    {c.correction}
                    <span className="ml-1.5 whitespace-nowrap text-xs text-stone-500">· {formatDayMonth(c.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* ── B. Execution Scorecard ───────────────────────────── */}
      {/* Second since 19 Nov 2026 (first from 10 Nov). A compact summary of
          the ratings the Detailed Performance Assessment gives, row for row —
          never a second assessment. Each row opens that section at the
          criterion. */}
      <section className={`${CARD} overflow-hidden`}>
        {/* The hero card (16 Nov 2026): the scorecard — criteria in two
            columns where there is room, the score beside its ring on phones,
            a one-line key. */}
        <div className="px-5 py-6 sm:px-10 sm:py-7">
          <SectionHeading title={title.scorecard!} />
          <div className="mt-5 overflow-hidden rounded-2xl ring-1 ring-inset ring-[#e6e2da] md:grid md:grid-cols-[15rem,minmax(0,1fr)]">
            <div className="flex items-center gap-4 bg-gradient-to-b from-[#fbf8f2] to-[#f6f0e4] px-4 py-4 md:flex-col md:justify-center md:gap-0 md:border-r md:border-[#ebe7e0] md:px-6 md:py-6 md:text-center">
              <ScoreRing pct={pct} size={112} caption={null} />
              <div className="min-w-0 md:flex md:flex-col md:items-center">
                <p className={`${KICKER} md:mt-3`}>Overall Execution Score</p>
                <p className="mt-1 text-[15px] font-semibold tabular-nums tracking-[-0.01em] text-stone-900">{formatOverallScore(card, { showPoints })}</p>
                {band ? (
                  <span className={`mt-2 ${CHIP} ${BAND_TONE[band.tone].soft} ${BAND_TONE[band.tone].text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${BAND_TONE[band.tone].dot}`} />
                    {band.label}
                  </span>
                ) : (
                  <p className="mt-1.5 text-[13px] leading-5 text-stone-600">There wasn&apos;t enough verifiable material in the recording to calculate a score.</p>
                )}
                {uvNote && (
                  <p className="mt-2.5 flex max-w-[15rem] items-start gap-1.5 text-left text-[11.5px] leading-[1.45] text-stone-500">
                    <HelpCircle size={12} className="mt-px flex-shrink-0 text-sky-600" />
                    {uvNote}
                  </p>
                )}
              </div>
            </div>

            {/* Two columns from xl, where each is ~320px wide; the rows share
                the panel's height evenly so they line up with the score. */}
            <ul className="grid grid-cols-1 border-t border-[#ebe7e0] bg-white md:border-t-0 xl:auto-rows-fr xl:grid-cols-2">
              {card.criteria.map((c) => {
                const number = criterionDisplayNumber(c.key)
                const style = VERDICT[c.verdict]
                return (
                  <li key={c.key} className="border-b border-[#efece6] xl:[&:last-child:nth-child(odd)]:col-span-2 xl:[&:nth-child(odd):not(:last-child)]:border-r">
                    <button
                      type="button"
                      onClick={() => openCriterion(c.key)}
                      className={`group flex h-full w-full items-center gap-2.5 px-4 py-3 touch:py-3.5 text-left transition-colors hover:bg-[#fcf9f3] focus-visible:bg-[#fcf9f3] focus-visible:outline-none sm:px-5`}
                    >
                      {number ? <span className={NUMBER}>{number.replace(/\.$/, '')}</span> : <span className="w-6 flex-shrink-0" />}
                      <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-5 text-stone-800 transition-colors group-hover:text-stone-950">{criterionLabel(c)}</span>
                      <span className={`${CHIP} ${style.chip}`}>
                        {style.icon}{SCORECARD_RATING[c.verdict]}
                      </span>
                      <ChevronRight size={14} className="-mr-1 flex-shrink-0 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-[#a07530]" />
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="bg-[#fcfbf9] px-4 py-2.5 md:col-span-2 sm:px-5">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] leading-5 text-stone-500">
                <span className="inline-flex items-center gap-1.5 font-medium text-stone-700"><CheckCircle2 size={12} className="text-emerald-600" /> {SHOW_SCORE_POINTS ? 'Strong = 1' : 'Strong counts in full'}</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-stone-700"><AlertTriangle size={12} className="text-amber-600" /> {SHOW_SCORE_POINTS ? 'Partial = 0.5' : 'Partial counts half'}</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-stone-700"><XCircle size={12} className="text-rose-600" /> {SHOW_SCORE_POINTS ? 'Weak = 0' : 'Weak counts nothing'}</span>
                <span>N/A and UV (not verifiable from the audio) are left out; Commercial Outcome is never scored. Select a criterion for its evidence.</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── C. Follow-Up Assessment (open) ────────────────────── */}
      {/* Rafa's Follow-Up Decision Support, once written, takes the place of
          the older "Where it stands" tiles and one-sentence next step; until
          then they show as before, with the way to get it. The coach button
          stays either way. */}
      {title.follow_up && (followUp || support) && (
        <section className={CARD}>
          <div className={CARD_BODY}>
            <SectionHeading title={title.follow_up} />
            {support ? (
              <FollowUpSupportBlock
                text={support}
                busy={followUpBusy}
                error={followUpError}
                onRegenerate={canRegenerateFollowUp ? onRequestFollowUp : undefined}
                playbookHref={playbookHref}
              />
            ) : (
              <>
                {followUp && followUp.rows.length > 0 && (
                  <div className="mt-6">
                    <p className={KICKER}>Where it stands</p>
                    {/* An odd last tile takes the full row rather than leaving a hole. */}
                    <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
                      {followUp.rows.map((r) => <StandingTile key={r.key} label={r.label} text={r.text} />)}
                    </dl>
                  </div>
                )}
                {followUpSupportApplies(card) && onRequestFollowUp && (
                  <GetFollowUpSupport busy={followUpBusy} error={followUpError} onRequest={onRequestFollowUp} playbookHref={playbookHref} />
                )}
              </>
            )}
            {((!support && followUp?.nextStep) || onChooseTrack) && (
              <NextStepPanel text={support ? null : followUp?.nextStep ?? null} onStart={onChooseTrack ? () => onChooseTrack('commercial') : undefined} />
            )}
          </div>
        </section>
      )}

      {/* ── D, E, F: collapsed until opened ───────────────────── */}
      {/* ── D. What You Did Well / Main Areas for Improvement ── */}
      {title.review && (
        <Collapsible
          title={title.review}
          hint={`${plural(strengths.length, 'strength')} · ${plural(improvements.length, 'area', 'areas')} for improvement`}
          open={open.review}
          onToggle={() => toggle('review')}
        >
          <PointGroup
            title="What You Did Well"
            icon={<CheckCircle2 size={14} />}
            items={card.strengths}
            empty="No strengths could be grounded in the transcript evidence."
            marker="bg-emerald-50 text-emerald-700 ring-emerald-600/20"
          />
          <div className={`mt-9 border-t ${HAIRLINE} pt-9`}>
            <PointGroup
              title="Main Areas for Improvement"
              icon={<TrendingUp size={14} />}
              items={card.improvements}
              empty="No material controllable improvements were identified."
              marker="bg-amber-50 text-amber-700 ring-amber-600/25"
            />
          </div>
        </Collapsible>
      )}

      {/* ── E. Detailed Performance Assessment (collapsed) ────── */}
      <Collapsible
        title={title.detail!}
        hint="Each criterion with the evidence, the assessment and better wording"
        open={open.detail}
        onToggle={() => toggle('detail')}
      >
        <ol className="divide-y divide-[#efece6]">
          {card.criteria.flatMap((c, i) => {
            const row = <CriterionRow key={c.key} criterion={c} onTimestampClick={onTimestampClick} onFlag={onFlag} />
            if (i !== 2) return [row]
            return [
              <li key="commercial-outcome" className={CRITERION_ROW}>
                <CriterionHeading number="3" chip={<span className={`${CHIP} ${VERDICT.na.chip}`}><MinusCircle size={13} /> Not scored</span>}>
                  Commercial Outcome<span className="sr-only"> — NOT SCORED</span>
                </CriterionHeading>
                <div className={`mt-3 ${MEASURE} sm:pl-9`}>
                  {card.commercial_outcome_summary ? (
                    <p className="text-[14.5px] leading-[1.7] text-stone-700">{outcomeLabel(card.declared_outcome)}. {card.commercial_outcome_summary}</p>
                  ) : (
                    <p className="text-[14.5px] leading-[1.7] text-stone-700">
                      {card.commercial_outcome_label && (
                        <span className="mr-2 align-[1px]"><OutcomeBadge tone={outcomeTone}>{card.commercial_outcome_label}</OutcomeBadge></span>
                      )}
                      {card.commercial_outcome_note}
                    </p>
                  )}
                  {onFlag && (
                    <FlagButton onClick={() => onFlag(null, 'Commercial Outcome', card.commercial_outcome_summary || card.commercial_outcome_note)}>
                      Something not right here?
                    </FlagButton>
                  )}
                </div>
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
        <h4 className={`flex items-center gap-2.5 ${SUBHEAD}`}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#fbf7ee] text-[#8f6626] ring-1 ring-inset ring-[#c8973f]/20">
            <Quote size={13} />
          </span>
          Objections and Handling
        </h4>
        {card.objections.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No genuine objections were raised in the transcript.</p>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            {card.objections.map((o, i) => (
              <div key={i} className="rounded-xl bg-white p-4 ring-1 ring-inset ring-[#e9e5de] sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="mt-px flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#fbf7ee] text-[#8f6626]">
                    <Quote size={13} />
                  </span>
                  <p className={`${MEASURE} pt-0.5 text-[15px] font-medium leading-6 text-stone-900`}>{o.objection}</p>
                </div>
                <div className="mt-5 flex flex-col gap-4 sm:pl-10">
                  <div>
                    <p className={KICKER}>How you handled it</p>
                    <p className={`mt-1.5 ${MEASURE} text-[14.5px] leading-[1.7] text-stone-700`}>{o.handled}</p>
                  </div>
                  {(o.original_wording || o.trc_improved_response) && (
                    <div className={`grid grid-cols-1 gap-3 ${o.original_wording && o.trc_improved_response ? 'sm:grid-cols-2' : ''}`}>
                      {o.original_wording && (
                        <div className="rounded-lg bg-[#faf8f5] px-4 py-3.5 ring-1 ring-inset ring-[#ebe7e0]">
                          <p className={KICKER}>Original</p>
                          <p className="mt-1.5 text-sm italic leading-6 text-stone-600">{o.original_wording}</p>
                        </div>
                      )}
                      {o.trc_improved_response && (
                        <div className={`${GOLD_PANEL} rounded-lg px-4 py-3.5`}>
                          <p className={KICKER_GOLD}>TRC doctrine</p>
                          <p className="mt-1.5 text-sm leading-6 text-stone-900">{o.trc_improved_response}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {o.principle && (
                    <p className={`${MEASURE} text-xs leading-5 text-stone-500`}><span className="font-semibold text-stone-700">Relevant principle: </span>{o.principle}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {card.deeper_analysis.length > 0 && (
          <div className={`mt-9 flex flex-col gap-8 border-t ${HAIRLINE} pt-9`}>
            {card.deeper_analysis.map((s, i) => (
              <div key={i}>
                <h4 className={SUBHEAD}>{titleCaseHeading(s.heading)}</h4>
                <p className={`mt-2.5 ${MEASURE} whitespace-pre-wrap text-[15px] leading-[1.75] text-stone-700`}>{s.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-9 flex flex-col gap-4">
          <div className="rounded-2xl bg-gradient-to-br from-[#fcf9f2] to-[#f7eedb] p-5 ring-1 ring-inset ring-[#c8973f]/30 sm:p-7">
            <p className={`flex items-center gap-2 ${KICKER_GOLD}`}>
              <MessageCircleQuestion size={13} /> Final Coaching Question
            </p>
            <p className="mt-3.5 max-w-[44rem] text-pretty font-serif text-[19px] font-medium leading-[1.55] text-stone-900 sm:text-[21px]">{card.coaching_question}</p>
            {onDiscussCoachingQuestion && (
              <button type="button" onClick={onDiscussCoachingQuestion} className={`mt-6 ${PRIMARY_BUTTON}`}>
                <MessageSquare size={13} /> Answer this with your coach
              </button>
            )}
          </div>

          {/* Two-track invitation. */}
          {(card.coaching_invitation || onChooseTrack) && (
            <div className="rounded-2xl bg-white p-5 ring-1 ring-inset ring-[#e6e2da] sm:p-7">
              <PanelTitle icon={<Compass size={14} />}>Continue With Your Coach</PanelTitle>
              <p className={`mt-3 ${MEASURE} text-[14.5px] leading-[1.75] text-stone-700`}>
                {card.coaching_invitation || 'You can practise the most important improvement from this meeting, or work on the next commercial action for this opportunity. Which would help you most right now?'}
              </p>
              {onChooseTrack && (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TrackButton icon={<Target size={15} />} track="execution" onClick={onChooseTrack} />
                  {/* The next step itself is in the Follow-Up Assessment, so it isn't repeated here. */}
                  <TrackButton icon={<Compass size={15} />} track="commercial" onClick={onChooseTrack} />
                </div>
              )}
            </div>
          )}

          {onAskCoach && <AskCoachBox onAsk={onAskCoach} />}
        </div>
      </Collapsible>

      <footer className="px-2 pb-1 text-center text-[11.5px] leading-5 text-stone-500">
        {meta.generatedAt ? `Generated ${formatDayMonthYearTime(meta.generatedAt)}` : ''}
        {meta.modelUsed ? ` · ${meta.modelUsed}` : ''}
        {' · Evidence quoted verbatim from the transcript'}
      </footer>
    </article>
  )
}

function OutcomeBadge({ tone, large = false, children }: { tone: { chip: string; dot: string }; large?: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold tracking-[0.02em] ring-1 ring-inset ${large ? 'px-3 py-1 text-xs' : 'px-2.5 py-1 text-[11px]'} ${tone.chip}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {children}
    </span>
  )
}

// "A. Negotiation Result" → the letter for the gold mark and the name beside it.
function splitTitle(title: string): { letter: string | null; name: string } {
  const m = /^([A-Z])\.\s+(.+)$/.exec(title)
  return m ? { letter: m[1], name: m[2] } : { letter: null, name: title }
}

function LetterMark({ letter }: { letter: string }) {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-b from-[#fdfaf3] to-[#f4e9d1] font-serif text-[15px] font-semibold text-[#8a6224] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(160,117,48,0.14)] ring-1 ring-inset ring-[#d9bf8a]/70"
    >
      {letter}
    </span>
  )
}

function SectionHeading({ title }: { title: string }) {
  const { letter, name } = splitTitle(title)
  return (
    <h3 className="flex items-center gap-3.5 text-[18px] font-semibold tracking-[-0.012em] text-stone-900">
      {letter && <LetterMark letter={letter} />}
      <span className="min-w-0">
        {letter && <span className="sr-only">{letter}. </span>}
        {name}
      </span>
    </h3>
  )
}

// One line of the Follow-Up's "Where it stands". A leading verdict the coach
// wrote in capitals ("NOT SCHEDULED.") is set apart so the lines can be
// scanned, and a lead-in that only repeats the tile's label ("CEO buy-in: …")
// is dropped. The verdict stays neutral, never coloured: the only ratings on
// the card are the scorecard's.
function StandingTile({ label, text }: { label: string; text: string }) {
  const { status, rest } = standingParts(label, text)
  return (
    <div className="rounded-xl bg-[#faf8f5] px-4 py-3.5 ring-1 ring-inset ring-[#ece8e1] sm:px-5 sm:py-4">
      <dt className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] font-semibold leading-5 text-stone-900">
        {label}
        {status && (
          <span className="rounded-md bg-white px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-stone-700 ring-1 ring-inset ring-stone-900/10">
            {status}
          </span>
        )}
      </dt>
      {rest && <dd className="mt-1.5 text-[14px] leading-[1.6] text-stone-600">{rest}</dd>}
    </div>
  )
}

function standingParts(label: string, text: string): { status: string | null; rest: string } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  const CAPS = /^([A-Z][A-Z'’ -]*[A-Z])\.\s*/
  let t = text.trim()
  const lead = /^([^:.]{2,40}):\s+/.exec(t)
  if (lead && (norm(lead[1]) === norm(label) || CAPS.test(t.slice(lead[0].length)))) t = t.slice(lead[0].length)
  const caps = CAPS.exec(t)
  if (caps) return { status: caps[1], rest: t.slice(caps[0].length) }
  return { status: null, rest: t.charAt(0).toUpperCase() + t.slice(1) }
}

// The Follow-Up Decision Support as Rafa's prompt writes it (markdown). Any
// HTML in the reply is shown as text, never rendered.
function FollowUpSupportBlock({ text, busy, error, onRegenerate, playbookHref }: {
  text: string
  busy: boolean
  error: string | null
  onRegenerate?: () => void
  playbookHref?: string
}) {
  const html = marked.parse(followUpDisplayText(text).replace(/&/g, '&amp;').replace(/</g, '&lt;'), { gfm: true, breaks: true, async: false }) as string
  return (
    <>
      <div className={`mt-6 rounded-2xl border border-[#e5e3df] bg-[#faf9f7] px-5 py-5 transition-opacity sm:px-7 sm:py-6 ${busy ? 'opacity-50' : ''}`}>
        <p className={`flex items-center gap-2 ${KICKER_GOLD}`}><Sparkles size={13} /> Follow-Up Decision Support</p>
        <div className="pattern-prose mt-3 [&_p]:my-2.5 [&_ol]:my-2.5 [&_ul]:my-2" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <FollowUpFooter busy={busy} error={error} playbookHref={playbookHref} action={onRegenerate ? { label: busy ? 'Rewriting…' : 'Regenerate', onClick: onRegenerate } : undefined} />
    </>
  )
}

// Before the Follow-Up Decision Support exists (cards from before 18 Nov 2026,
// or while it is being written right after a new card).
function GetFollowUpSupport({ busy, error, onRequest, playbookHref }: {
  busy: boolean
  error: string | null
  onRequest: () => void
  playbookHref?: string
}) {
  return (
    <>
      <div className="mt-6 rounded-2xl border border-dashed border-[#d6d3cd] bg-[#faf9f7] px-5 py-5 sm:px-7">
        <p className={`flex items-center gap-2 ${KICKER_GOLD}`}><Sparkles size={13} /> Follow-Up Decision Support</p>
        <p className={`mt-2 ${MEASURE} text-[14px] leading-6 text-stone-600`}>
          How strong the commercial interest is, and up to three follow-up tactics from the TRC Retorno Strategy Playbook that fit
          this meeting. You decide which to use, if any.
        </p>
        <button
          type="button"
          onClick={onRequest}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 touch:py-3 text-sm font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {busy ? 'Writing recommendations from the playbook… usually under a minute' : 'Get follow-up recommendations'}
        </button>
      </div>
      <FollowUpFooter busy={busy} error={error} playbookHref={playbookHref} />
    </>
  )
}

function FollowUpFooter({ busy, error, playbookHref, action }: {
  busy: boolean
  error: string | null
  playbookHref?: string
  action?: { label: string; onClick: () => void }
}) {
  if (!playbookHref && !action && !error) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
      {playbookHref && (
        <a href={playbookHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-stone-800 underline-offset-4 hover:underline touch:py-1.5">
          <BookOpen size={14} /> Read the full Retorno Strategy Playbook
        </a>
      )}
      {action && (
        <button type="button" onClick={action.onClick} disabled={busy} className="inline-flex items-center gap-1.5 text-stone-500 transition-colors hover:text-stone-900 disabled:opacity-50 touch:py-1.5">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {action.label}
        </button>
      )}
      {error && <span role="alert" className="inline-flex items-center gap-1.5 text-red-700"><AlertCircle size={14} /> {error}</span>}
    </div>
  )
}

// The Follow-Up's call to action, the card's warm dark panel: the next step
// and the button to work on it with the coach are what the eye finds after
// the result, because getting people into that conversation is the point.
function NextStepPanel({ text, onStart }: { text: string | null; onStart?: () => void }) {
  return (
    <div className="relative mt-6 overflow-hidden rounded-2xl bg-[#1c1917] px-5 py-6 text-white sm:px-8 sm:py-7">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(212,165,74,0.24),transparent_58%)]" />
      <div className="relative">
        <p className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#e2c17f]">
          <Compass size={13} /> {text ? 'Recommended next step' : 'Next commercial action'}
        </p>
        {text && <p className={`mt-3 ${MEASURE} text-pretty text-[16px] leading-[1.65] text-white/90 sm:text-[17px]`}>{text}</p>}
        {onStart && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <button
              type="button"
              onClick={onStart}
              className="group inline-flex items-center justify-between gap-3 rounded-xl bg-[#d4a54a] px-5 py-3 touch:py-3.5 text-left text-sm font-semibold text-stone-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_24px_-10px_rgba(212,165,74,0.7)] transition hover:bg-[#e0b55c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e2c17f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1c1917] sm:justify-center sm:gap-2"
            >
              {/* On a phone the label wraps; it reads left-aligned with the arrow at the end. */}
              <MessageSquare size={15} className="hidden flex-shrink-0 sm:block" />
              <span>Work on the next steps with your coach</span>
              <ArrowRight size={15} className="flex-shrink-0 transition group-hover:translate-x-0.5" />
            </button>
            <span className="text-[12.5px] leading-5 text-white/60">{SALES_COACH_TRACKS.commercial.hint}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// A section that opens on demand: its own card, plainly clickable. While
// closed, a one-line hint says what is inside, so nothing is hidden without a
// clue that it is there. Opened, the card holds the content, with a second
// Hide at the bottom so a long section can be closed where reading ends.
function Collapsible({ title, hint, open, onToggle, children }: {
  title: string
  hint: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const { letter, name } = splitTitle(title)
  function hideFromBottom() {
    onToggle()
    // Closing a long section from its end leaves the reader far below it.
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  return (
    <section
      ref={ref}
      className={`${CARD} scroll-mt-20 transition-shadow duration-200 ${
        open ? '' : 'hover:ring-[#d8d1c5] hover:shadow-[0_1px_2px_rgba(28,25,23,0.05),0_18px_34px_-22px_rgba(28,25,23,0.32)]'
      }`}
    >
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`group flex w-full items-center gap-3.5 rounded-2xl px-5 py-5 text-left sm:gap-4 sm:px-10 sm:py-6 ${FOCUS}`}
        >
          {letter && <LetterMark letter={letter} />}
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold tracking-[-0.01em] text-stone-900 sm:text-[17px]">
              {letter && <span className="sr-only">{letter}. </span>}
              {name}
            </span>
            {!open && <span className="mt-0.5 block text-[12.5px] leading-5 text-stone-500">{hint}</span>}
          </span>
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-white p-2 text-xs font-medium text-stone-700 shadow-[0_1px_2px_rgba(28,25,23,0.06)] ring-1 ring-inset ring-stone-900/10 transition group-hover:text-stone-950 group-hover:ring-stone-900/20 sm:px-3 sm:py-1.5">
            <span className="hidden sm:inline">{open ? 'Hide' : 'Show'}</span>
            <ChevronDown size={15} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>
      </h3>
      {open && (
        <div className={`section-reveal border-t ${HAIRLINE} px-5 pb-6 pt-7 sm:px-10 sm:pb-8 sm:pt-8`}>
          {children}
          <div className="mt-8 flex justify-end">
            <button
              type="button"
              onClick={hideFromBottom}
              className={`inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 touch:py-2.5 text-xs font-medium text-stone-500 ring-1 ring-inset ring-stone-900/10 transition hover:text-stone-900 hover:ring-stone-900/20 ${FOCUS}`}
            >
              <ChevronUp size={14} /> Hide {letter ? `section ${letter}` : 'section'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function PanelTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-stone-900">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#fbf7ee] text-[#8f6626] ring-1 ring-inset ring-[#c8973f]/20">{icon}</span>
      {children}
    </p>
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
    <div className="rounded-2xl bg-white p-5 ring-1 ring-inset ring-[#e6e2da] sm:p-7">
      <PanelTitle icon={<MessageSquare size={14} />}>Ask the Coach Anything</PanelTitle>
      <p className={`mt-3 ${MEASURE} text-[13px] leading-[1.65] text-stone-500`}>
        About this negotiation, or about any part of the TRC method. The coach answers from TRC&apos;s own sales documents: the Overcoming Objections manual, the Sales Coaching Method, the negotiation examples and the follow-up playbook.
      </p>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
        rows={4}
        maxLength={4000}
        placeholder="For example: How do I deal with “It’s not my decision” type of objections?"
        className="mt-5 w-full resize-y rounded-xl border border-[#e3dfd7] bg-[#faf8f5] px-4 py-3.5 text-[14.5px] leading-6 text-stone-900 shadow-[inset_0_1px_2px_rgba(28,25,23,0.04)] outline-none transition placeholder:text-stone-400 focus:border-[#c8973f]/70 focus:bg-white focus:ring-4 focus:ring-[#c8973f]/10"
      />
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={submit} disabled={!question.trim()} className={PRIMARY_BUTTON}>
          <Send size={13} /> Ask the coach
        </button>
      </div>
    </div>
  )
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function PointGroup({ title, icon, items, empty, marker }: { title: string; icon: React.ReactNode; items?: SalesCoachCardPoint[]; empty: string; marker: string }) {
  return (
    <div>
      <h4 className={`flex items-center gap-2.5 ${SUBHEAD}`}>
        <span className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset ${marker}`}>{icon}</span>
        {title}
      </h4>
      {!items || items.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">{empty}</p>
      ) : (
        <ol className="mt-5 flex flex-col gap-6">
          {items.map((p, i) => (
            <li key={i} className="flex gap-3.5">
              <span className={`mt-px flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ring-1 ring-inset ${marker}`}>{i + 1}</span>
              <div className="min-w-0">
                <p className={`${MEASURE} text-[15px] font-semibold leading-6 tracking-[-0.005em] text-stone-900`}>{p.title.replace(/\.$/, '')}</p>
                <p className={`mt-1.5 ${MEASURE} text-[14.5px] leading-[1.7] text-stone-700`}>{p.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function TrackButton({ icon, track, onClick, sub }: { icon: React.ReactNode; track: SalesCoachTrack; onClick: (t: SalesCoachTrack) => void; sub?: string }) {
  const t = SALES_COACH_TRACKS[track]
  return (
    <button
      type="button"
      onClick={() => onClick(track)}
      className={`group flex items-center gap-3.5 rounded-xl bg-white px-4 py-4 text-left shadow-[0_1px_2px_rgba(28,25,23,0.05)] ring-1 ring-inset ring-stone-900/10 transition hover:bg-[#fffdf9] hover:shadow-[0_8px_20px_-12px_rgba(160,117,48,0.35)] hover:ring-[#c8973f]/50 ${FOCUS}`}
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#fdfaf3] to-[#f4e9d1] text-[#8f6626] ring-1 ring-inset ring-[#d9bf8a]/60">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">{t.label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-stone-500">{sub || t.hint}</span>
      </span>
      <ChevronRight size={15} className="flex-shrink-0 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-[#a07530]" />
    </button>
  )
}

function FlagButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-4 inline-flex items-center gap-1.5 rounded touch:py-2.5 text-[11.5px] font-medium text-stone-500 transition-colors hover:text-[#8f6626] ${FOCUS}`}
    >
      <Flag size={11} /> {children}
    </button>
  )
}

function TimestampButton({ ms, onClick }: { ms: number; onClick: (ms: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(ms)}
      title="Play from here"
      className={`mr-1.5 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 touch:px-3 touch:py-1.5 align-[1px] font-mono text-[10px] font-medium not-italic tabular-nums text-stone-600 shadow-[0_1px_1px_rgba(28,25,23,0.04)] ring-1 ring-inset ring-stone-900/10 transition-colors hover:bg-stone-900 hover:text-white hover:ring-stone-900 ${FOCUS}`}
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
      {label && <span className="font-medium not-italic text-stone-500">{label}: </span>}
      <span className="italic text-stone-700">{e.text}</span>
    </>
  )
}

// One quote or several, always in the same gold-ruled block.
function EvidenceLines({ evidence, onTimestampClick }: { evidence?: SalesCoachEvidence[]; onTimestampClick?: (ms: number) => void }) {
  if (!evidence || evidence.length === 0) return null
  return (
    <div>
      <p className={KICKER}>Evidence</p>
      <ul className="mt-2 flex flex-col gap-2 rounded-r-lg border-l-2 border-[#d4b06a] bg-[#faf8f5] py-3.5 pl-4 pr-4 text-[14px] leading-[1.7] text-stone-800">
        {evidence.map((e, i) => (
          <li key={i}><EvidenceItem e={e} onTimestampClick={onTimestampClick} /></li>
        ))}
      </ul>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={KICKER}>{label}</p>
      <p className="mt-1.5 text-[14.5px] leading-[1.7] text-stone-700">{children}</p>
    </div>
  )
}

// "4  CEO Buy-In  [Partial (0.5)]": the rating sits right after the name, as
// the sample card writes it ("4. CEO Buy-In — ⚠️ Partial (0.5)"), so it reads
// with the criterion instead of floating at the far edge of a wide row.
function CriterionHeading({ number, chip, children }: { number: string | number; chip: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className={NUMBER}>{number}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="min-w-0 text-[15.5px] font-semibold leading-6 tracking-[-0.01em] text-stone-900">{children}</p>
        {chip}
      </div>
    </div>
  )
}

function CriterionRow({ criterion: c, onTimestampClick, onFlag }: { criterion: SalesCoachCriterion; onTimestampClick?: (ms: number) => void; onFlag?: FlagHandler }) {
  const style = VERDICT[c.verdict]
  const meta = SALES_COACH_CRITERIA.find((k) => k.key === c.key)
  const label = meta?.label || c.label
  const aiSaid = c.evidence?.[0]?.text || c.reason || c.note || ''
  return (
    <li id={`criterion-${c.key}`} className={`${CRITERION_ROW} scroll-mt-24 transition-colors duration-500 first:pt-1 last:pb-1`}>
      <CriterionHeading number={meta?.number ?? ''} chip={<span className={`${CHIP} ${style.chip}`}>{style.icon}{VERDICT_RATING[c.verdict]}</span>}>
        {label}
      </CriterionHeading>
      <div className={`${MEASURE} sm:pl-9`}>
        {c.note && <p className="mt-1.5 text-xs leading-5 text-stone-500">{c.verdict === 'na' ? `Not applicable: ${c.note}` : c.note}</p>}
        <div className="mt-5 flex flex-col gap-5">
          <EvidenceLines evidence={c.evidence} onTimestampClick={onTimestampClick} />
          {c.reason && <Field label="Assessment">{c.reason}</Field>}
          {c.commercial_reality && <Field label="Commercial reality">{c.commercial_reality}</Field>}
          {c.better_approach && (
            <div className={`${GOLD_PANEL} px-4 py-4`}>
              <p className={KICKER_GOLD}>Better approach</p>
              <p className="mt-1.5 text-[14.5px] font-medium leading-[1.65] text-stone-900">{c.better_approach}</p>
            </div>
          )}
        </div>
        {onFlag && (c.scored || c.verdict === 'uv') && (
          <FlagButton onClick={() => onFlag(c.key, label, aiSaid)}>
            {c.verdict === 'uv' ? 'Tell the coach what happened' : 'Something not right here?'}
          </FlagButton>
        )}
      </div>
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
  el.classList.add('bg-[#fbf7ed]')
  setTimeout(() => el.classList.remove('bg-[#fbf7ed]'), 1600)
}
