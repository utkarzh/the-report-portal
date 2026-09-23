'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2, Globe2, Newspaper, UserRound, Users, Mic, Copy, Check,
  Sparkles, RefreshCw, AlertCircle, CalendarDays, Download, Loader2, ClipboardList, MessageSquare, FileText, Flag,
} from 'lucide-react'
import AudioPlayer, { type AudioPlayerHandle } from '@/components/transcriptions/AudioPlayer'
import MeetingPrepLoader from '@/components/meeting-prep/MeetingPrepLoader'
import CoachConversation from '@/components/sales-coach/CoachConversation'
import ReportCardView from '@/components/sales-coach/ReportCardView'
import CorrectionModal, { type FlagTarget } from '@/components/sales-coach/CorrectionModal'
import TranscriptPlayer from '@/components/sales-coach/TranscriptPlayer'
import { formatCost, formatTokens } from '@/lib/claude/tokens'
import { coachGreeting, formatOutcomeDetails, formatScore, outcomeLabel, pickTranscript, suggestedCoachingPrompts } from '@/lib/sales-coach'
import { formatDayMonth, formatDayMonthYear } from '@/lib/date-format'
import type { SalesCoachNegotiation, SalesCoachMessage, SalesCoachCorrection } from '@/types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Busy = null | 'transcribing' | 'analyzing'
type Tab = 'card' | 'transcript' | 'coach' | 'submission'
type StepState = 'done' | 'active' | 'error' | 'upcoming'

const ANALYSIS_HINTS = [
  'Reading the whole transcript…',
  'Identifying who is speaking…',
  'Checking the planteo build-up against the TRC formula…',
  'Looking for the offer, the price and the closing question…',
  'Weighing CEO buy-in and preference…',
  'Scoring each applicable criterion…',
  'Drafting the objections and TRC-doctrine alternatives…',
  'Writing the coaching question…',
]
const TRANSCRIBE_HINTS = [
  'Sending the recording to the transcription service…',
  'Separating the speakers…',
  'Transcribing — long recordings take a few minutes…',
  'Almost there…',
]

interface Props {
  negotiation: SalesCoachNegotiation
  messages: SalesCoachMessage[]
  corrections: SalesCoachCorrection[]
  audioUrl: string | null
  isAdmin: boolean
  // True right after submission: transcribe (if audio) and generate the Report
  // Card without another click. Never true on a plain revisit.
  autoStart: boolean
  creatorName: string | null
}

export default function NegotiationWorkspace({ negotiation: initial, messages, corrections: initialCorrections, audioUrl, isAdmin, autoStart, creatorName }: Props) {
  const router = useRouter()
  const [n, setN] = useState<SalesCoachNegotiation>(initial)
  const [corrections, setCorrections] = useState<SalesCoachCorrection[]>(initialCorrections)
  const [flagTarget, setFlagTarget] = useState<FlagTarget | null>(null)
  const [coachPrefill, setCoachPrefill] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(() =>
    initial.stage === 'transcribing' ? 'transcribing' : initial.stage === 'analyzing' ? 'analyzing' : null,
  )
  const [subStatus, setSubStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(
    initial.stage === 'failed' ? initial.error || 'The last step didn’t complete. You can run it again.' : null,
  )
  const [elapsedSecs, setElapsedSecs] = useState(0)
  const [tab, setTab] = useState<Tab>('card')
  const audioRef = useRef<AudioPlayerHandle>(null)
  // Current audio position (ms) — drives the highlighted transcript line.
  const [activeMs, setActiveMs] = useState(0)
  // A clicked timestamp — in the transcript or in a Report Card evidence quote
  // — jumps to that moment and starts playing immediately, and switches to
  // the Transcript tab so the line being played is visible.
  const seekAndPlay = useCallback((ms: number) => {
    audioRef.current?.seekTo(ms / 1000)
    audioRef.current?.play()
  }, [])
  const jumpToTranscript = useCallback((ms: number) => {
    setTab('transcript')
    seekAndPlay(ms)
  }, [seekAndPlay])
  const startedRef = useRef(false)
  const autoStartRef = useRef(autoStart)

  const transcript = pickTranscript(n)
  const hasCard = Boolean(n.report_card)

  useEffect(() => {
    if (!busy) return
    const startedAt = Date.now()
    setElapsedSecs(0)
    const t = setInterval(() => setElapsedSecs(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [busy])

  const fetchRow = useCallback(async (): Promise<SalesCoachNegotiation | null> => {
    try {
      const res = await fetch(`/api/sales-coach/${initial.id}`, { cache: 'no-store' })
      if (!res.ok) return null
      const data = (await res.json()) as { negotiation?: SalesCoachNegotiation }
      return data.negotiation ?? null
    } catch {
      return null
    }
  }, [initial.id])

  // A run is in progress server-side (this tab reloaded, or another tab
  // started it): poll until the stage settles.
  const reconnect = useCallback(async () => {
    setBusy('analyzing')
    setError(null)
    for (let attempt = 0; attempt < 200; attempt++) {
      await sleep(3000)
      const fresh = await fetchRow()
      if (!fresh) continue
      if (fresh.stage !== 'analyzing') {
        setN(fresh)
        if (fresh.stage === 'failed') setError(fresh.error || 'The Report Card could not be generated. Please try again.')
        setBusy(null)
        router.refresh()
        return
      }
    }
    setError('The Report Card is still being generated. Refresh the page in a moment.')
    setBusy(null)
  }, [fetchRow, router])

  const runAnalyze = useCallback(async () => {
    setBusy('analyzing')
    setSubStatus(null)
    setError(null)
    try {
      const res = await fetch(`/api/sales-coach/${initial.id}/analyze`, { method: 'POST' })
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || 'Could not start the Report Card.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalRow: SalesCoachNegotiation | null = null
      let errMsg: string | null = null
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
          try {
            const j = JSON.parse(data) as { status?: string; done?: boolean; negotiation?: SalesCoachNegotiation; error?: string }
            if (j.status) setSubStatus(j.status)
            if (j.done && j.negotiation) finalRow = j.negotiation
            if (j.error) errMsg = j.error
          } catch {}
        }
      }
      if (errMsg) throw new Error(errMsg)
      if (finalRow) setN(finalRow)
      else {
        const fresh = await fetchRow()
        if (fresh) setN(fresh)
      }
      setTab('card')
      setBusy(null)
      router.refresh()
    } catch (e) {
      // The stream may have dropped while the server kept working — read the
      // row before deciding it failed.
      const fresh = await fetchRow()
      if (fresh?.stage === 'complete' && fresh.report_card) {
        setN(fresh)
        setBusy(null)
        router.refresh()
        return
      }
      if (fresh?.stage === 'analyzing') {
        await reconnect()
        return
      }
      if (fresh) setN(fresh)
      setError(e instanceof Error ? e.message : 'The Report Card could not be generated. Please try again.')
      setBusy(null)
    }
  }, [initial.id, fetchRow, reconnect, router])

  const runTranscribe = useCallback(async () => {
    setBusy('transcribing')
    setError(null)
    try {
      const submit = await fetch(`/api/sales-coach/${initial.id}/transcribe`, { method: 'POST' })
      if (!submit.ok) {
        const d = await submit.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || 'Could not start transcription.')
      }
      const sd = (await submit.json()) as { status?: string }
      if (sd.status !== 'completed') {
        let finished = false
        for (let attempt = 0; attempt < 1200; attempt++) {
          await sleep(3000)
          const res = await fetch(`/api/sales-coach/${initial.id}/transcribe`, { cache: 'no-store' })
          if (!res.ok) continue
          const data = (await res.json()) as { status?: string; error?: string }
          if (data.status === 'completed') { finished = true; break }
          if (data.status === 'error') throw new Error(data.error || 'Transcription failed. Please try again.')
        }
        if (!finished) throw new Error('Transcription is taking longer than expected. Please try again.')
      }
      const fresh = await fetchRow()
      if (fresh) setN(fresh)
      setBusy(null)
      if (autoStartRef.current) {
        autoStartRef.current = false
        await runAnalyze()
      } else {
        router.refresh()
      }
    } catch (e) {
      const fresh = await fetchRow()
      if (fresh) setN(fresh)
      setError(e instanceof Error ? e.message : 'Transcription failed. Please try again.')
      setBusy(null)
    }
  }, [initial.id, fetchRow, runAnalyze, router])

  // Stage-driven start: a mount that finds a run in progress reconnects; a
  // fresh submission starts the next step; anything else waits for the user.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (autoStart) window.history.replaceState(null, '', window.location.pathname)
    if (initial.stage === 'transcribing') {
      runTranscribe()
    } else if (initial.stage === 'analyzing') {
      reconnect()
    } else if (autoStart && initial.stage === 'transcribed' && !initial.report_card) {
      runAnalyze()
    } else {
      autoStartRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function retry() {
    if (n.audio_path && !transcript) runTranscribe()
    else runAnalyze()
  }

  // ── Stepper state ────────────────────────────────────────────────────
  const transcriptStep: StepState =
    busy === 'transcribing' ? 'active' : transcript ? 'done' : error ? 'error' : 'upcoming'
  const cardStep: StepState =
    busy === 'analyzing' ? 'active' : hasCard ? 'done' : error && transcript ? 'error' : 'upcoming'
  const coachStep: StepState = hasCard && !busy ? 'done' : 'upcoming'
  const steps = [
    { label: 'Submitted', sub: formatDayMonth(n.created_at), state: 'done' as StepState },
    { label: 'Transcript', sub: busy === 'transcribing' ? 'Usually 1–3 min' : transcript ? (transcript.source === 'system' ? 'Speaker-labelled' : 'Provided') : n.audio_path ? 'Pending' : '—', state: transcriptStep },
    { label: 'Report Card', sub: busy === 'analyzing' ? 'Usually 2–4 min' : hasCard ? formatScore(Number(n.execution_score), n.execution_denominator) : 'Pending', state: cardStep },
    { label: 'Coaching', sub: hasCard ? (messages.length > 0 ? `${messages.length} messages` : 'Ready') : 'After the card', state: coachStep },
  ]

  const meta = {
    company: n.company,
    interviewee: [n.interviewee_name, n.interviewee_position].filter(Boolean).join(', ') || null,
    publication: n.media_publication,
    country: n.country,
    submittedBy: creatorName || n.submitted_by_name || null,
    date: n.created_at,
    generatedAt: n.updated_at,
    modelUsed: n.model_used,
  }

  // Personalized from THIS negotiation's own Report Card, so the coach feels
  // like a continuation of what was just read, not a blank box.
  const coachStarters = n.report_card ? suggestedCoachingPrompts(n.report_card) : []
  const coachGreetingText = n.report_card ? coachGreeting(n.report_card, n.company) : undefined
  const hasCoachingHistory = messages.length > 0

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">{n.company || 'Untitled negotiation'}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              {n.interviewee_name && <span className="inline-flex items-center gap-1.5"><UserRound size={12} />{[n.interviewee_name, n.interviewee_position].filter(Boolean).join(', ')}</span>}
              {n.media_publication && <span className="inline-flex items-center gap-1.5"><Newspaper size={12} />{n.media_publication}</span>}
              {n.country && <span className="inline-flex items-center gap-1.5"><Globe2 size={12} />{n.country}</span>}
              <span className="inline-flex items-center gap-1.5"><CalendarDays size={12} />{formatDayMonthYear(n.created_at)}</span>
              {creatorName && <span className="inline-flex items-center gap-1.5"><Users size={12} />{creatorName}</span>}
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e3df] bg-[#f7f6f3] px-3 py-1 text-xs text-gray-600">
              <span className="text-gray-400">Declared</span>
              <span className="font-medium text-gray-800">{outcomeLabel(n.declared_outcome)}</span>
            </span>
            {hasCard && typeof n.execution_denominator === 'number' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black px-3 py-1 text-xs font-semibold tabular-nums text-white">
                {formatScore(Number(n.execution_score), n.execution_denominator)}<span className="font-normal text-white/60">score</span>
              </span>
            )}
          </div>
        </div>
        <Stepper steps={steps} />
        {audioUrl && (
          <div className="border-t border-[#eceae5] px-6 py-4">
            <AudioPlayer ref={audioRef} src={audioUrl} onTimeUpdate={(secs) => setActiveMs(secs * 1000)} />
          </div>
        )}
        {isAdmin && (n.tokens_total > 0 || Number(n.cost_usd) > 0) && (
          <div className="flex items-center gap-4 border-t border-[#eceae5] px-6 py-2.5 text-[11px] text-gray-400">
            <span>AI cost <span className="font-medium text-gray-700">{formatCost(Number(n.cost_usd))}</span></span>
            <span>Tokens <span className="font-medium text-gray-700">{formatTokens(n.tokens_total)}</span></span>
          </div>
        )}
      </div>

      {/* ── Body: exactly one thing at a time ───────────────────── */}
      {busy === 'transcribing' ? (
        <ProcessingPanel
          label="Transcribing the recording"
          estimate="Usually takes 1–3 minutes for a half-hour recording. The Report Card starts automatically once it's done."
          elapsedSecs={elapsedSecs}
          hints={TRANSCRIBE_HINTS}
        />
      ) : busy === 'analyzing' ? (
        <ProcessingPanel
          label={subStatus === 'correcting' ? 'Checking the Report Card' : 'Generating the Report Card'}
          estimate="Usually takes 2–4 minutes. The coach reads the whole transcript against the TRC Manual and Method and scores every applicable criterion with verbatim evidence. You can leave this page — it keeps running."
          elapsedSecs={elapsedSecs}
          hints={ANALYSIS_HINTS}
        />
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">{error}</p>
              <button type="button" onClick={retry} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-900">
                <RefreshCw size={13} /> {n.audio_path && !transcript ? 'Retry transcription' : 'Try again'}
              </button>
            </div>
          </div>
        </div>
      ) : !transcript ? (
        <div className="rounded-2xl border border-dashed border-[#d4d0c8] bg-[#faf9f7] px-6 py-10 text-center">
          <p className="text-sm font-medium text-gray-900">No transcript yet</p>
          <p className="mt-1 text-xs text-gray-500">The Report Card is produced once the recording has been transcribed.</p>
          {n.audio_path && (
            <button type="button" onClick={runTranscribe} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900">
              <Mic size={15} /> Transcribe the recording
            </button>
          )}
        </div>
      ) : !hasCard ? (
        <>
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-[#e5e3df] bg-white px-6 py-12 text-center shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fbf7ed] text-[#a07530]"><Sparkles size={22} /></div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Ready to generate the Report Card</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-gray-500">The coach reads the whole transcript against the TRC Manual and Method and scores every applicable criterion with verbatim evidence. Usually takes 2–4 minutes.</p>
            </div>
            <button type="button" onClick={runAnalyze} className="inline-flex items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900">
              <Sparkles size={15} /> Generate Report Card
            </button>
          </div>
          <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
            <TranscriptPlayer
              segments={n.system_transcript_segments}
              fallbackText={transcript.text}
              source={transcript.source}
              activeMs={audioUrl ? activeMs : undefined}
              onTimestampClick={audioUrl ? seekAndPlay : undefined}
            />
          </div>
          <SubmissionPanel n={n} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-[#e5e3df] bg-white p-1 text-xs font-medium shadow-sm">
              <TabButton active={tab === 'card'} onClick={() => setTab('card')} icon={<Sparkles size={13} />} label="Report Card" />
              <TabButton active={tab === 'transcript'} onClick={() => setTab('transcript')} icon={<FileText size={13} />} label="Transcript" />
              <TabButton active={tab === 'coach'} onClick={() => setTab('coach')} icon={<MessageSquare size={13} />} label="Coaching" badge={!hasCoachingHistory} />
              <TabButton active={tab === 'submission'} onClick={() => setTab('submission')} icon={<ClipboardList size={13} />} label="Submission" />
            </div>
            {tab === 'card' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFlagTarget({ criterionKey: null, fieldLabel: 'General feedback', aiSaid: '', general: true })}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400"
                >
                  <Flag size={13} /> Give feedback
                </button>
                <CopyTextButton text={n.report_card_markdown} />
                <a
                  href={`/api/sales-coach/${n.id}/download`}
                  className="inline-flex items-center gap-2 rounded-lg bg-black px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-900"
                >
                  <Download size={13} /> Download .docx
                </a>
              </div>
            )}
          </div>

          {tab === 'card' && n.report_card && (
            <ReportCardView
              card={n.report_card}
              meta={meta}
              onTimestampClick={audioUrl ? jumpToTranscript : undefined}
              corrections={corrections}
              onFlag={(criterionKey, fieldLabel, aiSaid) => setFlagTarget({ criterionKey, fieldLabel, aiSaid })}
              onDiscussCoachingQuestion={() => {
                setCoachPrefill(n.report_card?.coaching_question || '')
                setTab('coach')
              }}
              hasCoachingHistory={hasCoachingHistory}
              onStartCoaching={() => setTab('coach')}
            />
          )}
          {tab === 'transcript' && (
            <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
              <TranscriptPlayer
                segments={n.system_transcript_segments}
                fallbackText={transcript.text}
                source={transcript.source}
                activeMs={audioUrl ? activeMs : undefined}
                onTimestampClick={audioUrl ? seekAndPlay : undefined}
              />
            </div>
          )}
          {tab === 'coach' && (
            <CoachConversation
              negotiationId={n.id}
              initialMessages={messages}
              canCoach
              context={{ hasReportCard: true, transcriptWords: transcript.text.split(/\s+/).filter(Boolean).length }}
              initialInput={coachPrefill}
              onInitialInputConsumed={() => setCoachPrefill(null)}
              greeting={coachGreetingText}
              starters={coachStarters}
            />
          )}
          {tab === 'submission' && <SubmissionPanel n={n} open />}
        </>
      )}

      <CorrectionModal
        negotiationId={n.id}
        target={flagTarget}
        onClose={() => setFlagTarget(null)}
        onSaved={(c) => setCorrections((prev) => [...prev, c])}
        onRegenerate={runAnalyze}
      />
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────

function Stepper({ steps }: { steps: { label: string; sub: string; state: StepState }[] }) {
  return (
    <ol className="grid grid-cols-4 gap-2 border-t border-[#eceae5] px-6 py-4">
      {steps.map((s, i) => (
        <li key={s.label} className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
              s.state === 'done' ? 'bg-black text-white'
              : s.state === 'active' ? 'bg-[#fbf7ed] text-[#a07530] ring-2 ring-[#c8973f]/50'
              : s.state === 'error' ? 'bg-red-50 text-red-600 ring-1 ring-red-200'
              : 'border border-[#e5e3df] bg-white text-gray-400'
            }`}
          >
            {s.state === 'done' ? <Check size={13} /> : s.state === 'active' ? <Loader2 size={13} className="animate-spin" /> : s.state === 'error' ? <AlertCircle size={13} /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className={`block truncate text-xs font-semibold ${s.state === 'upcoming' ? 'text-gray-400' : 'text-gray-900'}`}>{s.label}</span>
            <span className={`block truncate text-[11px] ${s.state === 'active' ? 'text-[#a07530]' : 'text-gray-400'}`}>{s.sub}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function ProcessingPanel({ label, estimate, elapsedSecs, hints }: { label: string; estimate: string; elapsedSecs: number; hints: string[] }) {
  return (
    <div className="flex flex-col gap-3">
      <MeetingPrepLoader label={label} elapsedSecs={elapsedSecs} hints={hints} />
      <p className="mx-auto max-w-lg text-center text-xs leading-5 text-gray-500">{estimate}</p>
    </div>
  )
}

function TabButton({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors ${active ? 'bg-black text-white' : 'text-gray-600 hover:text-black'}`}>
      {icon}{label}
      {badge && !active && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[#c8973f]" />}
    </button>
  )
}

function CopyTextButton({ text }: { text: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  return (
    <button
      type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {} }}
      className="inline-flex items-center gap-2 rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:border-gray-400"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy as text'}
    </button>
  )
}

function SubmissionPanel({ n, open = false }: { n: SalesCoachNegotiation; open?: boolean }) {
  const [expanded, setExpanded] = useState(open)
  const details = formatOutcomeDetails(n.declared_outcome, n.outcome_details)
  const reps = (n.company_reps || []).filter((p) => p.name || p.role)
  const trc = (n.trc_members || []).filter((p) => p.name || p.role)

  return (
    <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
      {!open && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500"><ClipboardList size={13} /> Submission & transcript</span>
          <span className="text-xs text-gray-400">{expanded ? 'Hide' : 'Show'}</span>
        </button>
      )}
      {expanded && (
        <div className={open ? '' : 'mt-5'}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field icon={<Building2 size={12} />} label="Company" value={n.company} />
            <Field icon={<Globe2 size={12} />} label="Country" value={n.country} />
            <Field icon={<Newspaper size={12} />} label="Media / publication" value={n.media_publication} />
            <Field icon={<UserRound size={12} />} label="Interviewee" value={[n.interviewee_name, n.interviewee_position].filter(Boolean).join(' — ')} />
            <Field icon={<UserRound size={12} />} label="Submitted by" value={n.submitted_by_name} />
            <Field icon={<Mic size={12} />} label="Recording" value={n.original_filename || (n.audio_path ? 'Audio uploaded' : n.uploaded_transcript ? 'Transcript pasted' : '—')} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <ParticipantChips label="Company representatives present" people={reps} />
            <ParticipantChips label="TRC team members present" people={trc} />
          </div>
          <div className="mt-5 rounded-xl border border-[#eceae5] bg-[#faf9f7] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Declared outcome</p>
              <span className="rounded-full bg-black px-2.5 py-0.5 text-[11px] font-semibold text-white">{outcomeLabel(n.declared_outcome)}</span>
            </div>
            {details.length > 0 && (
              <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {details.map((d) => (
                  <div key={d.label}>
                    <dt className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{d.label}</dt>
                    <dd className="mt-0.5 text-sm text-gray-800">{d.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {n.declared_outcome === 'uncertain' && <p className="mt-2 text-xs text-gray-500">No additional details required — the coach assesses the recorded evidence.</p>}
          </div>
          {n.other_comments && (
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Other contextual comments</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-700">{n.other_comments}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl border border-[#eceae5] bg-[#fcfbf8] px-4 py-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{icon}{label}</p>
      <p className="mt-1 truncate text-sm text-gray-800" title={value || undefined}>{value || '—'}</p>
    </div>
  )
}

function ParticipantChips({ label, people }: { label: string; people: { name: string; role: string }[] }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400"><Users size={12} />{label}</p>
      {people.length === 0 ? (
        <p className="mt-2 text-sm text-gray-400">—</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {people.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e3df] bg-white px-3 py-1 text-xs text-gray-700">
              <span className="font-medium text-gray-900">{p.name || 'Unnamed'}</span>
              {p.role && <span className="text-gray-400">· {p.role}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
