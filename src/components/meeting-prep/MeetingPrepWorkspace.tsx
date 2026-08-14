'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { marked } from 'marked'
import {
  ArrowLeft, CalendarClock, Sparkles, WandSparkles, Check, Pencil,
  Download, ShieldAlert, UserRound, Building2, Target, Newspaper, Loader2,
} from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import AiDisclaimerModal, { useAiDisclaimer } from '@/components/ui/AiDisclaimerModal'
import DeleteMeetingPrepButton from '@/components/meeting-prep/DeleteMeetingPrepButton'
import MeetingPrepLoader from '@/components/meeting-prep/MeetingPrepLoader'
import { useStickToBottom } from '@/lib/use-stick-to-bottom'
import type { MeetingPrepSession, MeetingPrepResearchSections, MeetingPrepStage } from '@/types'

marked.use({ gfm: true, breaks: true })

const SECTION_ORDER: (keyof MeetingPrepResearchSections)[] = ['interviewee', 'organisation', 'motivation_profiles', 'quotes_news']
const SECTION_LABELS: Record<keyof MeetingPrepResearchSections, string> = {
  interviewee: 'Interviewee Research',
  organisation: 'Organisation Research',
  motivation_profiles: 'Commercial Motivation Profiling',
  quotes_news: 'Recent Quotes & Latest News',
}
const SECTION_ICONS: Record<keyof MeetingPrepResearchSections, typeof UserRound> = {
  interviewee: UserRound,
  organisation: Building2,
  motivation_profiles: Target,
  quotes_news: Newspaper,
}

type TabKey = 'research' | 'points' | 'planteo' | 'final'

// Picks the right tab from whatever data/stage a session currently carries —
// used both for the initial mount and for a reconnect poll landing on a new
// stage, so the view always jumps to wherever the real work is happening.
function tabForSession(data: {
  stage: MeetingPrepStage
  final_output?: string | null
  planteo_output?: string | null
  presentation_points?: string[] | null
}): TabKey {
  if (data.stage === 'final_generating' || data.stage === 'complete' || data.final_output) return 'final'
  if (data.stage === 'planteo_generating' || data.stage === 'planteo_pending' || data.planteo_output) return 'planteo'
  if (data.stage === 'points_generating' || data.stage === 'points_pending' || (data.presentation_points?.length ?? 0) > 0) return 'points'
  return 'research'
}

interface Props {
  session: MeetingPrepSession
  isGenerating: boolean
  isAdmin: boolean
}

export default function MeetingPrepWorkspace({ session: initialSession, isGenerating, isAdmin }: Props) {
  const router = useRouter()
  const [session, setSession] = useState(initialSession)
  const [stage, setStage] = useState<MeetingPrepStage>(initialSession.stage)
  const [sections, setSections] = useState<MeetingPrepResearchSections>(initialSession.research_sections || {})
  const [points, setPoints] = useState<string[]>(initialSession.presentation_points || [])
  const [planteo, setPlanteo] = useState(initialSession.planteo_output || '')
  const [finalOutput, setFinalOutput] = useState(initialSession.final_output || '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // human-readable status while a stage is running
  const [reconnecting, setReconnecting] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>(() => tabForSession(initialSession))

  const [acceptedSections, setAcceptedSections] = useState<Set<string>>(new Set())
  const [editingSection, setEditingSection] = useState<keyof MeetingPrepResearchSections | null>(null)
  const [feedbackSection, setFeedbackSection] = useState<keyof MeetingPrepResearchSections | null>(null)
  const [sectionFeedback, setSectionFeedback] = useState('')
  const [sectionBusy, setSectionBusy] = useState<keyof MeetingPrepResearchSections | null>(null)

  const [editingPoint, setEditingPoint] = useState<number | null>(null)
  const [pointFeedback, setPointFeedback] = useState<{ index: number | 'all'; text: string } | null>(null)
  const [pointBusy, setPointBusy] = useState<number | 'all' | null>(null)

  const [editingPlanteo, setEditingPlanteo] = useState(false)
  const [planteoFeedback, setPlanteoFeedback] = useState('')
  const [showPlanteoFeedback, setShowPlanteoFeedback] = useState(false)

  const [usage, setUsage] = useState({
    tokens_total: initialSession.tokens_total || 0,
    web_searches: initialSession.web_searches || 0,
    cost_usd: Number(initialSession.cost_usd) || 0,
  })

  const hasStartedRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollAttemptsRef = useRef(0)
  const [stalled, setStalled] = useState(false)
  const [resettingStage, setResettingStage] = useState(false)
  const isProcessing = Boolean(busy)
  const disclaimer = useAiDisclaimer(isProcessing || reconnecting)

  // Live elapsed-time counter for the loader, ticking for as long as any
  // stage is busy — reset the moment a new busy period starts.
  const [elapsedSecs, setElapsedSecs] = useState(0)
  useEffect(() => {
    if (!isProcessing) return
    const startedAt = Date.now()
    setElapsedSecs(0)
    const ticker = setInterval(() => setElapsedSecs(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(ticker)
  }, [isProcessing])

  // Stage-driven, not query-flag-driven: a fresh mount that finds the session
  // already mid-stage (e.g. the user refreshed while it was generating) can
  // never safely assume it's the tab that originally kicked things off — that
  // tab's in-flight fetch died with the previous page. So any mount that sees
  // an in-progress stage always polls; only 'input' (nothing has run yet)
  // starts a fresh generation. Relying on `?generating=true` instead used to
  // leave a refreshed page matching neither branch and sitting there forever.
  useEffect(() => {
    if (hasStartedRef.current) return
    hasStartedRef.current = true
    if (stage === 'input') {
      startResearch()
    } else if (['researching', 'points_generating', 'planteo_generating', 'final_generating'].includes(stage)) {
      startReconnect()
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scroll = useStickToBottom<HTMLDivElement>(`${stage}:${Object.keys(sections).length}:${points.length}:${planteo.length}:${finalOutput.length}`)

  function stopReconnect() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setReconnecting(false)
    setBusy(null)
  }

  // After this many 3s polls (~2 minutes) with no stage change, the original
  // request likely died without updating the row (e.g. a dev-server restart
  // mid-request) rather than still being genuinely busy — offer a manual reset
  // instead of polling forever with no way out.
  const STALL_THRESHOLD = 40

  // `fromStage` is the in-progress stage we're waiting to move OFF of. Pass it
  // explicitly when reconnecting from a just-dropped stream, because the closure
  // `stage` can still be the pre-generation value ('input') and would make the
  // poll stop the instant it sees the (still in-progress) stage.
  function startReconnect(fromStage: string = stage) {
    setReconnecting(true)
    setStalled(false)
    pollAttemptsRef.current = 0
    setBusy('Working in the background — this will update automatically…')
    const poll = async () => {
      try {
        const res = await fetch(`/api/meeting-prep/${session.id}`)
        if (!res.ok) return
        const data: MeetingPrepSession = await res.json()
        setUsage({ tokens_total: data.tokens_total, web_searches: data.web_searches, cost_usd: Number(data.cost_usd) })
        if (data.stage !== fromStage) {
          setSession(data)
          setStage(data.stage)
          setSections(data.research_sections || {})
          setPoints(data.presentation_points || [])
          setPlanteo(data.planteo_output || '')
          setFinalOutput(data.final_output || '')
          setActiveTab(tabForSession(data))
          if (data.stage === 'failed') setError(data.error || 'Something went wrong.')
          stopReconnect()
          return
        }
        pollAttemptsRef.current += 1
        if (pollAttemptsRef.current >= STALL_THRESHOLD) {
          setStalled(true)
          stopReconnect()
        }
      } catch {
        /* transient */
      }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
  }

  async function retryStalledStage() {
    setResettingStage(true)
    try {
      const res = await fetch(`/api/meeting-prep/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetStalledStage: true }),
      })
      if (res.ok) {
        // Hard reload onto the clean path — simplest way to get a fresh mount
        // that re-evaluates the (now reset) stage from scratch.
        window.location.href = window.location.pathname
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to reset. Please try refreshing the page.')
    } catch {
      setError('Network error. Please try refreshing the page.')
    } finally {
      setResettingStage(false)
    }
  }

  async function readSSE(res: Response, onEvent: (parsed: Record<string, unknown>) => void) {
    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') return
        try {
          onEvent(JSON.parse(raw))
        } catch {}
      }
    }
  }

  // ── Step 2/3: Research ────────────────────────────────────────────────────
  async function startResearch() {
    setError(null)
    setStage('researching')
    setBusy('Researching the interviewee and organisation…')
    // Did the stream deliver a terminal verdict (done/error)? If it just ENDS
    // (connection dropped, response cut after the server persisted, proxy
    // timeout on a long research), we must not hang on the loader — fall back to
    // polling, which picks up the result the server already saved.
    let settled = false
    try {
      const res = await fetch(`/api/meeting-prep/${session.id}/research`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Research failed. Please try again.')
        setStage('failed')
        setBusy(null)
        return
      }
      await readSSE(res, (parsed) => {
        if (parsed.error) {
          settled = true
          setError(parsed.error as string)
          setStage('failed')
        } else if (parsed.status === 'web_search_start') {
          setBusy('Searching the web for the latest information…')
        } else if (parsed.status === 'validating') {
          setBusy('Checking the research holds together…')
        } else if (parsed.status === 'refining') {
          setBusy('Deepening the research…')
        } else if (parsed.done) {
          settled = true
          setSections(parsed.sections as MeetingPrepResearchSections)
          setStage('awaiting_review')
        }
      })
      if (settled) {
        setBusy(null)
        router.refresh()
      } else {
        // Stream ended with no verdict — poll for the persisted result.
        startReconnect('researching')
      }
    } catch {
      // Network drop mid-stream: the server may still finish (or already has).
      // Poll rather than declaring failure and losing a completed run.
      startReconnect('researching')
    }
  }

  // ── Step 4: Review ────────────────────────────────────────────────────────
  function acceptSection(key: keyof MeetingPrepResearchSections) {
    setAcceptedSections(prev => new Set(prev).add(key))
  }

  async function saveSectionEdit(key: keyof MeetingPrepResearchSections, text: string) {
    const updated = { ...sections, [key]: text }
    setSections(updated)
    setEditingSection(null)
    acceptSection(key)
    await fetch(`/api/meeting-prep/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ researchSections: updated }),
    })
  }

  async function regenerateSection(key: keyof MeetingPrepResearchSections) {
    setSectionBusy(key)
    setError(null)
    try {
      const res = await fetch(`/api/meeting-prep/${session.id}/research/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: key, feedback: sectionFeedback }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to regenerate this section.')
        return
      }
      setSections(prev => ({ ...prev, [key]: data.text }))
      setAcceptedSections(prev => { const next = new Set(prev); next.delete(key); return next })
      setFeedbackSection(null)
      setSectionFeedback('')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSectionBusy(null)
    }
  }

  const allSectionsReviewed = SECTION_ORDER.every(k => acceptedSections.has(k))

  async function advanceToPoints() {
    setError(null)
    setStage('points_generating')
    setBusy('Drafting the three presentation points…')
    setActiveTab('points')
    try {
      const res = await fetch(`/api/meeting-prep/${session.id}/points`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to generate presentation points.')
        setStage('awaiting_review')
        setActiveTab('research')
        return
      }
      setPoints(data.points)
      setUsage(u => ({ ...u, tokens_total: u.tokens_total + (data.usage?.tokens_total || 0), cost_usd: u.cost_usd + (data.usage?.cost_usd || 0) }))
      setStage('points_pending')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
      setStage('awaiting_review')
      setActiveTab('research')
    } finally {
      setBusy(null)
    }
  }

  // ── Step 5: Presentation points ──────────────────────────────────────────
  async function savePointEdit(index: number, text: string) {
    const updated = points.map((p, i) => (i === index ? text : p))
    setPoints(updated)
    setEditingPoint(null)
    await fetch(`/api/meeting-prep/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presentationPoints: updated }),
    })
  }

  async function regeneratePoints(target: number | 'all', feedback: string) {
    setPointBusy(target)
    setError(null)
    try {
      const res = await fetch(`/api/meeting-prep/${session.id}/points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerateIndex: target === 'all' ? undefined : target, feedback }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to regenerate.')
        return
      }
      setPoints(data.points)
      setPointFeedback(null)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setPointBusy(null)
    }
  }

  async function approvePointsAndGeneratePlanteo() {
    setError(null)
    setStage('planteo_generating')
    setBusy('Building the planteo…')
    setActiveTab('planteo')
    try {
      const res = await fetch(`/api/meeting-prep/${session.id}/planteo`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to generate the planteo.')
        setStage('points_pending')
        setActiveTab('points')
        return
      }
      setPlanteo(data.planteo)
      setStage('planteo_pending')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
      setStage('points_pending')
      setActiveTab('points')
    } finally {
      setBusy(null)
    }
  }

  // ── Step 6: Planteo ───────────────────────────────────────────────────────
  async function savePlanteoEdit(text: string) {
    setPlanteo(text)
    setEditingPlanteo(false)
    await fetch(`/api/meeting-prep/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planteoOutput: text }),
    })
  }

  async function regeneratePlanteo() {
    setBusy('Regenerating the planteo…')
    setError(null)
    try {
      const res = await fetch(`/api/meeting-prep/${session.id}/planteo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: planteoFeedback }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to regenerate the planteo.')
        return
      }
      setPlanteo(data.planteo)
      setShowPlanteoFeedback(false)
      setPlanteoFeedback('')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function approvePlanteoAndGenerateFinal() {
    setError(null)
    setStage('final_generating')
    setBusy('Assembling the final document…')
    setActiveTab('final')
    try {
      const res = await fetch(`/api/meeting-prep/${session.id}/final-document`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to generate the final document.')
        setStage('planteo_pending')
        setActiveTab('planteo')
        return
      }
      setFinalOutput(data.output)
      setStage('complete')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
      setStage('planteo_pending')
      setActiveTab('planteo')
    } finally {
      setBusy(null)
    }
  }

  const tabs: { key: TabKey; label: string; available: boolean; locked: boolean }[] = [
    { key: 'research', label: 'Research', available: true, locked: stage !== 'awaiting_review' },
    { key: 'points', label: 'Presentation Points', available: points.length > 0 || stage === 'points_generating', locked: stage !== 'points_pending' },
    { key: 'planteo', label: 'Planteo', available: Boolean(planteo) || stage === 'planteo_generating', locked: stage !== 'planteo_pending' },
    { key: 'final', label: 'Document', available: Boolean(finalOutput) || stage === 'final_generating', locked: stage === 'complete' },
  ]

  return (
    <div className="flex h-full bg-[#f0efec]">
      <AiDisclaimerModal open={disclaimer.open} onClose={disclaimer.dismiss} />

      {/* Subject side panel */}
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-[#e5e3df] bg-white">
        <div className="flex-1 overflow-y-auto p-5">
          <Link href="/meeting-preparation" className="inline-flex items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-gray-700">
            <ArrowLeft size={13} />
            <span>Meeting Preparation</span>
          </Link>

          <div className="mt-5 flex items-center gap-2.5">
            <div className="flex-shrink-0 rounded-lg bg-black p-2 text-white">
              <CalendarClock size={15} />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Meeting prep</p>
          </div>
          <h1 className="mt-3 text-sm font-semibold leading-snug text-gray-900">{session.interviewee_name}</h1>

          <div className="mt-5 space-y-3.5">
            <InfoRow label="Title" value={session.interviewee_title} />
            <InfoRow label="Type" value={session.interviewee_type === 'company_ceo' ? 'Company CEO' : 'Government Official'} />
            <InfoRow label="Organisation" value={session.company_org} />
            <InfoRow label="Company Country" value={session.company_country} />
            <InfoRow label="Publication" value={session.publication} />
            <InfoRow label="Publication Country" value={session.publication_country} />
          </div>

          <div className="mt-6 border-t border-[#e5e3df] pt-4">
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Advertiser History</p>
            <p className="text-[13px] leading-snug text-gray-700">
              {session.advertiser_history_status === 'yes' ? session.advertiser_history_details : 'No previous advertising history on record.'}
            </p>
          </div>

          {usage.tokens_total > 0 && (
            <div className="mt-6 border-t border-[#e5e3df] pt-4">
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Usage</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Tokens</span>
                  <span className="font-medium tabular-nums text-gray-700">{formatTokens(usage.tokens_total)}</span>
                </div>
                {usage.web_searches > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Searches</span>
                    <span className="font-medium tabular-nums text-gray-700">{usage.web_searches}</span>
                  </div>
                )}
                {isAdmin && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Cost</span>
                    <span className="font-medium tabular-nums text-gray-700">${usage.cost_usd.toFixed(4)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="border-t border-[#e5e3df] p-5">
            <DeleteMeetingPrepButton sessionId={session.id} title={session.interviewee_name} redirectTo="/meeting-preparation" />
          </div>
        )}
      </aside>

      {/* Main content */}
      <div ref={scroll.ref} onScroll={scroll.onScroll} onWheel={scroll.onWheel} className="flex-1 overflow-y-auto">
        {/* Sticky step nav — lets you jump straight to a section instead of scrolling through everything */}
        <div className="sticky top-0 z-10 border-b border-[#e5e3df] bg-[#f0efec]/95 backdrop-blur-sm">
          <div className="mx-auto max-w-3xl px-6">
            <TabNav tabs={tabs} active={activeTab} onChange={setActiveTab} />
          </div>
        </div>

        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">

          {error && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p>{error}</p>
                {stage === 'failed' && (
                  <button
                    onClick={() => { setError(null); startResearch() }}
                    className="mt-1 text-xs font-semibold uppercase tracking-wider text-red-700 underline underline-offset-2 hover:text-red-900"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}

          {stalled && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
              <p>This is taking much longer than expected — the request may have been interrupted. You can retry from here without losing anything already approved.</p>
              <button
                onClick={retryStalledStage}
                disabled={resettingStage}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-800 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-900 disabled:opacity-50"
              >
                {resettingStage ? 'Resetting…' : 'Retry this step'}
              </button>
            </div>
          )}

          {activeTab === 'research' && (
            <>
              {!stalled && ['input', 'researching'].includes(stage) && (
                <MeetingPrepLoader label={busy || 'Working…'} elapsedSecs={elapsedSecs} />
              )}

              {!['input', 'researching'].includes(stage) && Object.keys(sections).length > 0 && (
                <ResearchReviewCard
                  sections={sections}
                  locked={stage !== 'awaiting_review'}
                  acceptedSections={acceptedSections}
                  editingSection={editingSection}
                  setEditingSection={setEditingSection}
                  feedbackSection={feedbackSection}
                  setFeedbackSection={setFeedbackSection}
                  sectionFeedback={sectionFeedback}
                  setSectionFeedback={setSectionFeedback}
                  sectionBusy={sectionBusy}
                  onAccept={acceptSection}
                  onSaveEdit={saveSectionEdit}
                  onRegenerate={regenerateSection}
                />
              )}

              {stage === 'awaiting_review' && (
                <div className="flex justify-end">
                  <button
                    onClick={advanceToPoints}
                    disabled={!allSectionsReviewed}
                    className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md disabled:opacity-40 disabled:hover:translate-y-0"
                  >
                    <Sparkles size={15} />
                    Continue to Presentation Points
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === 'points' && (
            <>
              {!stalled && stage === 'points_generating' && (
                <MeetingPrepLoader label={busy || 'Working…'} elapsedSecs={elapsedSecs} />
              )}

              {points.length > 0 && stage !== 'points_generating' && (
                <PointsCard
                  points={points}
                  locked={stage !== 'points_pending'}
                  editingPoint={editingPoint}
                  setEditingPoint={setEditingPoint}
                  pointFeedback={pointFeedback}
                  setPointFeedback={setPointFeedback}
                  pointBusy={pointBusy}
                  onSaveEdit={savePointEdit}
                  onRegenerate={regeneratePoints}
                />
              )}

              {stage === 'points_pending' && (
                <div className="flex justify-end">
                  <button
                    onClick={approvePointsAndGeneratePlanteo}
                    className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
                  >
                    <Check size={15} />
                    Approve Points &amp; Build Planteo
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === 'planteo' && (
            <>
              {!stalled && stage === 'planteo_generating' && (
                <MeetingPrepLoader label={busy || 'Working…'} elapsedSecs={elapsedSecs} />
              )}

              {planteo && stage !== 'planteo_generating' && (
                <PlanteoCard
                  planteo={planteo}
                  locked={stage !== 'planteo_pending'}
                  editing={editingPlanteo}
                  setEditing={setEditingPlanteo}
                  showFeedback={showPlanteoFeedback}
                  setShowFeedback={setShowPlanteoFeedback}
                  feedback={planteoFeedback}
                  setFeedback={setPlanteoFeedback}
                  busy={isProcessing}
                  onSaveEdit={savePlanteoEdit}
                  onRegenerate={regeneratePlanteo}
                />
              )}

              {stage === 'planteo_pending' && (
                <div className="flex justify-end">
                  <button
                    onClick={approvePlanteoAndGenerateFinal}
                    className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
                  >
                    <Check size={15} />
                    Approve Planteo &amp; Generate Document
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === 'final' && (
            <>
              {!stalled && stage === 'final_generating' && (
                <MeetingPrepLoader label={busy || 'Working…'} elapsedSecs={elapsedSecs} />
              )}

              {stage === 'complete' && finalOutput && (
                <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold leading-tight text-gray-900">Meeting Preparation Document</h2>
                      <p className="mt-0.5 text-[11px] leading-tight text-gray-400">Ready to download</p>
                    </div>
                    <a
                      href={`/api/meeting-prep/${session.id}/download`}
                      className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-900"
                    >
                      <Download size={13} />
                      Download .docx
                    </a>
                  </div>
                  <div className="prose-research mt-4 text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: marked.parse(finalOutput) as string }} />
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  )
}

function TabNav({ tabs, active, onChange }: {
  tabs: { key: TabKey; label: string; available: boolean; locked: boolean }[]
  active: TabKey
  onChange: (key: TabKey) => void
}) {
  return (
    <nav className="flex items-center gap-1.5 overflow-x-auto py-3">
      {tabs.map((tab, i) => {
        const isActive = tab.key === active
        const isComplete = tab.available && tab.locked
        return (
          <button
            key={tab.key}
            onClick={() => tab.available && onChange(tab.key)}
            disabled={!tab.available}
            className={`group inline-flex flex-shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
              isActive
                ? 'bg-black text-white shadow-sm'
                : tab.available
                  ? 'text-gray-500 hover:bg-white hover:text-gray-900'
                  : 'cursor-not-allowed text-gray-300'
            }`}
          >
            <span
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                isActive ? 'bg-white/20 text-white' : isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
              }`}
            >
              {isComplete ? <Check size={10} /> : i + 1}
            </span>
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-gray-700">{value}</p>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

// ── Step 4: Research review card ──────────────────────────────────────────
function ResearchReviewCard({
  sections, locked, acceptedSections, editingSection, setEditingSection,
  feedbackSection, setFeedbackSection, sectionFeedback, setSectionFeedback,
  sectionBusy, onAccept, onSaveEdit, onRegenerate,
}: {
  sections: MeetingPrepResearchSections
  locked: boolean
  acceptedSections: Set<string>
  editingSection: keyof MeetingPrepResearchSections | null
  setEditingSection: (k: keyof MeetingPrepResearchSections | null) => void
  feedbackSection: keyof MeetingPrepResearchSections | null
  setFeedbackSection: (k: keyof MeetingPrepResearchSections | null) => void
  sectionFeedback: string
  setSectionFeedback: (v: string) => void
  sectionBusy: keyof MeetingPrepResearchSections | null
  onAccept: (k: keyof MeetingPrepResearchSections) => void
  onSaveEdit: (k: keyof MeetingPrepResearchSections, text: string) => void
  onRegenerate: (k: keyof MeetingPrepResearchSections) => void
}) {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Move focus (and the cursor) into the textarea the instant edit mode
  // opens, and settle the scroll position ourselves — otherwise the sudden
  // height change from swapping text for a tall textarea shoves the viewport
  // around with no compensation, which reads as "the part I clicked jumps away".
  useEffect(() => {
    if (!editingSection || !textareaRef.current) return
    const el = textareaRef.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [editingSection])

  return (
    <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold leading-tight text-gray-900">Research Review</h2>
      <p className="mt-0.5 text-[11px] leading-tight text-gray-400">
        {locked ? 'Accepted research (locked in for this session)' : 'Accept, edit, or regenerate each section before continuing'}
      </p>

      <div className="mt-5 flex flex-col gap-4">
        {SECTION_ORDER.map((key) => {
          const isAccepted = acceptedSections.has(key)
          const text = sections[key] || ''
          const isEditing = editingSection === key
          const isFeedbackOpen = feedbackSection === key
          const isBusy = sectionBusy === key
          const Icon = SECTION_ICONS[key]

          return (
            <div key={key} className={`rounded-xl border p-4 transition-colors ${isEditing ? 'border-black/15 bg-white' : 'border-[#e5e3df] bg-[#faf9f7]'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-gray-500 shadow-sm">
                    <Icon size={14} />
                  </span>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">{SECTION_LABELS[key]}</h3>
                </div>
                {!locked && (
                  isAccepted ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                      <Check size={12} /> Accepted
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Needs review</span>
                  )
                )}
              </div>

              {isBusy ? (
                <div className="mt-3 flex items-center gap-2 py-4 text-sm text-gray-400">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Regenerating…</span>
                </div>
              ) : isEditing ? (
                <div className="mt-3">
                  <Textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} className="text-sm" label="" />
                  <div className="mt-3 flex gap-3">
                    <button onClick={() => onSaveEdit(key, draft)} className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900">Save</button>
                    <button onClick={() => setEditingSection(null)} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="prose-research mt-3 text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: marked.parse(text || '_Not yet written_') as string }} />
              )}

              {!locked && !isEditing && !isBusy && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!isAccepted && (
                    <button onClick={() => onAccept(key)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-100">
                      <Check size={13} /> Accept
                    </button>
                  )}
                  <button onClick={() => { setEditingSection(key); setDraft(text) }} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-100">
                    <Pencil size={13} /> Edit
                  </button>
                  <button onClick={() => { setFeedbackSection(isFeedbackOpen ? null : key); setSectionFeedback('') }} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-100">
                    <WandSparkles size={13} /> Regenerate
                  </button>
                </div>
              )}

              {isFeedbackOpen && (
                <div className="mt-3 rounded-xl border border-[#e5e3df] bg-white p-4">
                  <Textarea
                    label="Redirect this section"
                    placeholder="e.g. Focus more on their international expansion plans. Find stronger recent quotes."
                    value={sectionFeedback}
                    onChange={(e) => setSectionFeedback(e.target.value)}
                    rows={2}
                  />
                  <div className="mt-3 flex gap-3">
                    <button onClick={() => onRegenerate(key)} className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900">Regenerate</button>
                    <button onClick={() => setFeedbackSection(null)} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Step 5: Presentation points card ──────────────────────────────────────
function PointsCard({
  points, locked, editingPoint, setEditingPoint, pointFeedback, setPointFeedback,
  pointBusy, onSaveEdit, onRegenerate,
}: {
  points: string[]
  locked: boolean
  editingPoint: number | null
  setEditingPoint: (i: number | null) => void
  pointFeedback: { index: number | 'all'; text: string } | null
  setPointFeedback: (v: { index: number | 'all'; text: string } | null) => void
  pointBusy: number | 'all' | null
  onSaveEdit: (index: number, text: string) => void
  onRegenerate: (target: number | 'all', feedback: string) => void
}) {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editingPoint === null || !textareaRef.current) return
    const el = textareaRef.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [editingPoint])

  return (
    <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold leading-tight text-gray-900">3 Presentation Points</h2>
      <p className="mt-0.5 text-[11px] leading-tight text-gray-400">
        {locked ? 'Approved presentation points' : 'Edit or regenerate any point before approving'}
      </p>

      <div className="mt-5 flex flex-col gap-4">
        {points.map((point, i) => {
          const isEditing = editingPoint === i
          const isFeedbackOpen = pointFeedback?.index === i
          const isBusy = pointBusy === i

          return (
            <div key={i} className={`rounded-xl border p-4 transition-colors ${isEditing ? 'border-black/15 bg-white' : 'border-[#e5e3df] bg-[#faf9f7]'}`}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-semibold text-white">{i + 1}</span>
                {isBusy ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
                    <Loader2 size={14} className="animate-spin" />
                    <span>Regenerating…</span>
                  </div>
                ) : isEditing ? (
                  <div className="flex-1">
                    <Textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} className="text-sm" label="" />
                    <div className="mt-2 flex gap-3">
                      <button onClick={() => { onSaveEdit(i, draft); setEditingPoint(null) }} className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900">Save</button>
                      <button onClick={() => setEditingPoint(null)} className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="flex-1 text-sm leading-relaxed text-gray-800">{point}</p>
                )}
              </div>

              {!locked && !isEditing && !isBusy && (
                <div className="mt-2 ml-9 flex flex-wrap items-center gap-2">
                  <button onClick={() => { setEditingPoint(i); setDraft(point) }} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-100">
                    <Pencil size={13} /> Edit
                  </button>
                  <button onClick={() => setPointFeedback(isFeedbackOpen ? null : { index: i, text: '' })} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-100">
                    <WandSparkles size={13} /> Regenerate
                  </button>
                </div>
              )}

              {isFeedbackOpen && (
                <div className="mt-3 ml-9 rounded-xl border border-[#e5e3df] bg-white p-4">
                  <Textarea
                    label="What to change"
                    value={pointFeedback!.text}
                    onChange={(e) => setPointFeedback({ index: i, text: e.target.value })}
                    rows={2}
                  />
                  <div className="mt-3 flex gap-3">
                    <button onClick={() => onRegenerate(i, pointFeedback!.text)} className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900">Regenerate</button>
                    <button onClick={() => setPointFeedback(null)} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!locked && (
        <div className="mt-5 border-t border-[#e5e3df] pt-4">
          {pointFeedback?.index === 'all' ? (
            <div className="rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-4">
              <Textarea
                label="Reframe all three points"
                value={pointFeedback.text}
                onChange={(e) => setPointFeedback({ index: 'all', text: e.target.value })}
                rows={2}
              />
              <div className="mt-3 flex gap-3">
                <button onClick={() => onRegenerate('all', pointFeedback.text)} className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900">Regenerate All</button>
                <button onClick={() => setPointFeedback(null)} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setPointFeedback({ index: 'all', text: '' })} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200">
              <WandSparkles size={13} /> Reframe all three
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Step 6: Planteo card ───────────────────────────────────────────────────
function PlanteoCard({
  planteo, locked, editing, setEditing, showFeedback, setShowFeedback, feedback, setFeedback, busy, onSaveEdit, onRegenerate,
}: {
  planteo: string
  locked: boolean
  editing: boolean
  setEditing: (v: boolean) => void
  showFeedback: boolean
  setShowFeedback: (v: boolean) => void
  feedback: string
  setFeedback: (v: string) => void
  busy: boolean
  onSaveEdit: (text: string) => void
  onRegenerate: () => void
}) {
  const [draft, setDraft] = useState(planteo)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing || !textareaRef.current) return
    const el = textareaRef.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [editing])

  return (
    <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold leading-tight text-gray-900">Planteo Build-Up</h2>
      <p className="mt-0.5 text-[11px] leading-tight text-gray-400">
        {locked ? 'Approved planteo' : 'Edit directly or request a targeted regeneration'}
      </p>

      <div className="mt-4">
        {busy ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            <span>Working…</span>
          </div>
        ) : editing ? (
          <div>
            <Textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={14} className="text-sm" label="" />
            <div className="mt-3 flex gap-3">
              <button onClick={() => onSaveEdit(draft)} className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900">Save</button>
              <button onClick={() => setEditing(false)} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="prose-research text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: marked.parse(planteo) as string }} />
        )}
      </div>

      {!locked && !editing && !busy && (
        <div className="mt-5 border-t border-[#e5e3df] pt-4">
          {showFeedback ? (
            <div className="rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-4">
              <Textarea
                label="What to change"
                placeholder="e.g. Tighten the opening paragraph. Lean more on the investment-attraction angle."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
              />
              <div className="mt-3 flex gap-3">
                <button onClick={onRegenerate} className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900">Regenerate</button>
                <button onClick={() => setShowFeedback(false)} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setEditing(true); setDraft(planteo) }} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200">
                <Pencil size={13} /> Edit
              </button>
              <button onClick={() => setShowFeedback(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200">
                <WandSparkles size={13} /> Regenerate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
