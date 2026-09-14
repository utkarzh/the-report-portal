'use client'

import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, HelpCircle, Flag, Quote, MessageCircleQuestion } from 'lucide-react'
import { formatScore, outcomeLabel, SALES_COACH_CRITERIA, positionHeadline, applicableCriteriaCount } from '@/lib/sales-coach'
import type { SalesCoachReportCard, SalesCoachCriterion, SalesCoachVerdict } from '@/types'

// The Report Card as ONE document (US-039/040/041): identity header →
// scoreline → summary → nine criteria with verbatim evidence → scoreline recap
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

const POSITION_TONE: Record<string, string> = {
  'Positive/Won': 'bg-emerald-600 text-white',
  'Apparent Positive/Won — confirmation required': 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  'Controlled retorno': 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
  'Open retorno': 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  'Open, low-confidence retorno': 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  'Negative/Lost': 'bg-red-50 text-red-800 ring-1 ring-red-200',
  'Uncertain — insufficient evidence': 'bg-stone-100 text-stone-700 ring-1 ring-stone-200',
  'Management review recommended': 'bg-[#fbf7ed] text-[#a07530] ring-1 ring-[#c8973f]/40',
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

export default function ReportCardView({ card, meta, isAdmin = false }: { card: SalesCoachReportCard; meta: ReportCardMeta; isAdmin?: boolean }) {
  const scored = card.criteria.filter((c) => c.scored)
  const count = (v: SalesCoachVerdict) => scored.filter((c) => c.verdict === v).length

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

      {/* ── Scoreline ────────────────────────────────────────────── */}
      <div className="mx-6 rounded-xl bg-[#faf9f7] px-6 py-5 sm:mx-12">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex flex-shrink-0 items-baseline gap-1 text-gray-900">
            <span className="text-5xl font-semibold tabular-nums tracking-tight">{formatScore(card.execution_score, card.execution_denominator).split('/')[0]}</span>
            <span className="text-xl text-gray-400">/ {card.execution_denominator}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Execution score · {card.execution_denominator} applicable points
              {card.execution_denominator === applicableCriteriaCount(card.declared_outcome)
                ? ` · fixed for "${outcomeLabel(card.declared_outcome)}"`
                : ' · one or more criteria need audio verification'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${POSITION_TONE[card.assessed_position] || 'bg-stone-100 text-stone-700'}`}>
                {positionHeadline(card.assessed_position)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e3df] bg-white px-3 py-1 text-xs text-gray-600">
                <span className="text-gray-400">Declared</span>
                <span className="font-medium text-gray-800">{outcomeLabel(card.declared_outcome)}</span>
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1"><CheckCircle2 size={11} className="text-emerald-600" /> {count('pass')} met</span>
              <span className="inline-flex items-center gap-1"><AlertTriangle size={11} className="text-amber-600" /> {count('warn')} partly met</span>
              <span className="inline-flex items-center gap-1"><XCircle size={11} className="text-red-600" /> {count('fail')} not met</span>
              <span className="inline-flex items-center gap-1"><MinusCircle size={11} className="text-stone-400" /> {card.criteria.length - scored.length} not applicable</span>
            </div>
          </div>
        </div>
        <p className="mt-4 border-t border-[#e9e7e2] pt-4 text-[15px] font-medium leading-relaxed text-gray-900">{card.headline}</p>
        {((isAdmin && card.management_review) || card.discrepancy) && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-[#c8973f]/30 bg-[#fbf7ed] px-4 py-3 text-sm">
            <Flag size={14} className="mt-0.5 flex-shrink-0 text-[#a07530]" />
            <div>
              {isAdmin && card.management_review && (
                <p className="font-medium text-[#a07530]">
                  {card.review
                    ? `Reviewed by ${card.review.reviewed_by_name} — confirmed outcome: ${outcomeLabel(card.review.confirmed_outcome)}`
                    : 'Management review recommended'}
                </p>
              )}
              {card.discrepancy && <p className={`text-gray-700 ${isAdmin && card.management_review ? 'mt-0.5 text-xs' : ''}`}>{card.discrepancy}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="px-6 sm:px-12">
        <p className="py-6 text-[15px] leading-7 text-gray-800">{card.summary}</p>

        {/* ── Criteria ─────────────────────────────────────────── */}
        <Eyebrow>Criteria</Eyebrow>
        <ol className="divide-y divide-[#eceae5] border-y border-[#eceae5]">
          {card.criteria.map((c, i) => (
            <CriterionRow key={c.key} index={i + 1} criterion={c} assessedPosition={card.assessed_position} />
          ))}
        </ol>

        {/* ── Scoreline recap ──────────────────────────────────── */}
        <Eyebrow className="mt-8">Scoreline</Eyebrow>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Execution score</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums text-gray-900">{formatScore(card.execution_score, card.execution_denominator).replace('/', ' / ')} applicable points</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Commercial outcome</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">{card.assessed_position}</dd>
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
                <p className="mt-2 text-sm leading-6 text-gray-800"><span className="font-semibold text-gray-900">How the representative handled it. </span>{o.handled}</p>
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
        </div>
      </div>

      <footer className="border-t border-[#eceae5] px-6 py-3 text-center text-[11px] text-gray-400 sm:px-12">
        {meta.generatedAt ? `Generated ${new Date(meta.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
        {meta.modelUsed ? ` · ${meta.modelUsed}` : ''}
        {' · Evidence quoted verbatim from the transcript · Score recomputed in code'}
      </footer>
    </article>
  )
}

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-gray-400 ${className}`}>{children}</p>
}

function CriterionRow({ index, criterion: c, assessedPosition }: { index: number; criterion: SalesCoachCriterion; assessedPosition: string }) {
  const style = VERDICT[c.verdict]
  const label = SALES_COACH_CRITERIA.find((k) => k.key === c.key)?.label || c.label
  const isOutcome = c.key === 'outcome' && c.scored
  return (
    <li className="py-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex items-baseline gap-2.5">
          <span className="text-xs font-semibold tabular-nums text-gray-400">{String(index).padStart(2, '0')}</span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{label}</p>
            {c.note && !isOutcome && <p className="mt-0.5 text-xs text-gray-500">{c.note}</p>}
          </div>
        </div>
        {isOutcome ? (
          <span className={`inline-flex flex-shrink-0 items-center self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ${POSITION_TONE[assessedPosition] || 'bg-stone-100 text-stone-700'}`}>
            {positionHeadline(assessedPosition)}{c.note ? ` — ${c.note}` : ''}
          </span>
        ) : (
          <span className={`inline-flex flex-shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${style.chip}`}>
            {style.icon}{style.label}
          </span>
        )}
      </div>
      {(c.evidence?.length || c.reason) && (
        <div className="mt-3 flex flex-col gap-2 sm:pl-8">
          {c.evidence?.map((e, i) => (
            <div key={i} className="border-l-2 border-[#c8973f]/60 pl-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{e.label}</p>
              <p className="mt-0.5 text-sm italic leading-6 text-gray-700">{e.text}</p>
            </div>
          ))}
          {c.reason && <p className="text-sm leading-6 text-gray-800"><span className="font-semibold text-gray-900">Reason. </span>{c.reason}</p>}
        </div>
      )}
    </li>
  )
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())
}
