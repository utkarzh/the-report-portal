'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, CalendarClock, Download, ShieldAlert, ChevronDown, Sparkles, X, UserRound, Building2, Target, Newspaper,
} from 'lucide-react'
import AiDisclaimerModal, { useAiDisclaimer } from '@/components/ui/AiDisclaimerModal'
import DeleteMeetingPrepButton from '@/components/meeting-prep/DeleteMeetingPrepButton'
import MarkdownBlock, { BlockPlaceholder, renderMarkdown } from '@/components/meeting-prep/DocumentBlock'
import MobileDetailsToggle from '@/components/layout/MobileDetailsToggle'
import PointsBlock from '@/components/meeting-prep/PointsBlock'
import PlanteoBlock from '@/components/meeting-prep/PlanteoBlock'
import PipelineProgress, { type PipelineStep } from '@/components/meeting-prep/PipelineProgress'
import { interviewTypeLabel, researchSectionsComplete } from '@/lib/meeting-prep'
import {
  COLLAPSIBLE_BLOCKS, MINISTER_GUIDANCE, POINTS_NUMBER, PLANTEO_NUMBER, advertiserRecordMarkdown, finalBlockTitle, finalSectionsOf, showsMinisterGuidance, POINTS_TITLE, PLANTEO_TITLE, type AdvertiserRecord,
  type FinalBlockKey, type ScriptResource,
} from '@/lib/meeting-prep-document'
import type { MeetingPrepSession, MeetingPrepResearchSections, MeetingPrepStage } from '@/types'
import { useKeepScreenOn } from '@/lib/use-mobile'

type Step = 'research' | 'points' | 'planteo' | 'final'

// The in-progress stage each step persists while it runs (compare-and-set in
// its route), so any tab can tell a step is already running and wait for it.
const GENERATING: Partial<Record<MeetingPrepStage, Step>> = {
  researching: 'research',
  points_generating: 'points',
  planteo_generating: 'planteo',
  final_generating: 'final',
}
const PAUSED_STAGES: MeetingPrepStage[] = ['awaiting_review', 'points_pending', 'planteo_pending']

const RESEARCH_ORDER: (keyof MeetingPrepResearchSections)[] = ['interviewee', 'organisation', 'motivation_profiles', 'quotes_news']
const RESEARCH_LABELS: Record<keyof MeetingPrepResearchSections, string> = {
  interviewee: 'Interviewee research',
  organisation: 'Organisation research',
  motivation_profiles: 'Commercial motivation profiling',
  quotes_news: 'Recent quotes & latest news',
}
const RESEARCH_ICONS = { interviewee: UserRound, organisation: Building2, motivation_profiles: Target, quotes_news: Newspaper }

const STEP_STATUS: Record<Step, string> = {
  research: 'Researching the interviewee and organisation…',
  points: 'Writing the three presentation points…',
  planteo: 'Building the planteo…',
  final: 'Writing the Commercial Alert, snapshot, motivations and quotes…',
}

// ~5 minutes of 3s polls with no change: the request that owned the step most
// likely died without updating the row, so offer a reset instead of polling on.
const STALL_POLLS = 100

interface Props {
  session: MeetingPrepSession
  isAdmin: boolean
  recordingUrl: string | null
  samples: Record<ScriptResource, boolean>
  advertiser: AdvertiserRecord
}

export default function MeetingPrepWorkspace({ session: initialSession, isAdmin, recordingUrl, samples, advertiser }: Props) {
  // One copy of the session drives everything; sRef mirrors it synchronously
  // for the pipeline loop, which can't wait for a re-render between steps.
  const [s, setS] = useState<MeetingPrepSession>(initialSession)
  const sRef = useRef(initialSession)
  const patch = useCallback((u: Partial<MeetingPrepSession>) => {
    sRef.current = { ...sRef.current, ...u }
    setS(sRef.current)
  }, [])

  const id = s.id
  const type = s.interviewee_type
  const research = (s.research_sections || {}) as MeetingPrepResearchSections
  const researchReady = researchSectionsComplete(research)
  const points = s.presentation_points || []
  const planteo = s.planteo_output || ''
  const finalSections = useMemo(() => finalSectionsOf(s), [s])
  const complete = s.stage === 'complete'

  const [running, setRunning] = useState<Step | null>(null)
  const [status, setStatus] = useState('')
  const [pipelineError, setPipelineError] = useState<string | null>(
    initialSession.stage === 'failed'
      ? initialSession.error || 'The last run didn’t complete. You can run it again.'
      : PAUSED_STAGES.includes(initialSession.stage) ? initialSession.error : null,
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)
  const [resetting, setResetting] = useState(false)
  const pipelineRef = useRef(false)
  const startedRef = useRef(false)

  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running || !startedAt) return
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [running, startedAt])

  // Per-block activity and one-level undo of the last regenerate.
  const [blockBusy, setBlockBusy] = useState<FinalBlockKey | null>(null)
  const [blockUndo, setBlockUndo] = useState<Partial<Record<FinalBlockKey, string>>>({})
  const [pointBusy, setPointBusy] = useState<number | 'all' | null>(null)
  const [pointUndo, setPointUndo] = useState<Partial<Record<number, string>>>({})
  const [allPointsUndo, setAllPointsUndo] = useState<string[] | null>(null)
  const [planteoBusy, setPlanteoBusy] = useState(false)
  const [planteoUndo, setPlanteoUndo] = useState<string | null>(null)
  const [researchBusy, setResearchBusy] = useState<keyof MeetingPrepResearchSections | null>(null)
  const [researchUndo, setResearchUndo] = useState<Partial<Record<keyof MeetingPrepResearchSections, string>>>({})
  // Open by default: "everything else disappears from view, all the
  // research… I'm not sure I'm liking this" (client, SCRUM-47).
  // Blocks 4–6 and the research, once opened. Closed by default.
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({})
  const toggleBlock = (blockId: string) => setOpenBlocks((o) => ({ ...o, [blockId]: !o[blockId] }))
  const researchOpen = Boolean(openBlocks['block-research'])
  const [detailsOpen, setDetailsOpen] = useState(false)

  const pipelineActive = running !== null
  useKeepScreenOn(pipelineActive)
  const anyBusy = pipelineActive || blockBusy !== null || pointBusy !== null || planteoBusy || researchBusy !== null
  const disclaimer = useAiDisclaimer(pipelineActive)

  function addUsage(u?: { tokens_total?: number; web_searches?: number; cost_usd?: number }) {
    if (!u) return
    patch({
      tokens_total: (sRef.current.tokens_total || 0) + (u.tokens_total || 0),
      web_searches: (sRef.current.web_searches || 0) + (u.web_searches || 0),
      cost_usd: Number(sRef.current.cost_usd || 0) + (u.cost_usd || 0),
    })
  }

  async function fetchSession(): Promise<MeetingPrepSession | null> {
    try {
      const res = await fetch(`/api/meeting-prep/${id}`, { cache: 'no-store' })
      return res.ok ? ((await res.json()) as MeetingPrepSession) : null
    } catch {
      return null
    }
  }

  async function postJson(path: string, body: unknown = {}): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    try {
      const res = await fetch(`/api/meeting-prep/${id}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      return { ok: res.ok, status: res.status, data }
    } catch {
      return { ok: false, status: 0, data: {} }
    }
  }

  async function patchSession(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/meeting-prep/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setActionError(d.error || 'Your change couldn’t be saved. Please try again.')
        return false
      }
      return true
    } catch {
      setActionError('Network error: your change couldn’t be saved.')
      return false
    }
  }

  // Wait for a step that is running in another request (a dropped
  // connection, another tab, a refresh) to move the session off `stage`.
  async function waitWhile(stage: MeetingPrepStage): Promise<MeetingPrepSession | null> {
    for (let i = 0; i < STALL_POLLS; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const fresh = await fetchSession()
      if (!fresh) continue
      if (fresh.stage !== stage) {
        patch(fresh)
        return fresh
      }
    }
    setStalled(true)
    return null
  }

  async function readSSE(res: Response, onEvent: (e: Record<string, unknown>) => void) {
    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') return
        try { onEvent(JSON.parse(raw)) } catch {}
      }
    }
  }

  // ── The pipeline: research → points → planteo → document ────────────────

  async function stepResearch(): Promise<boolean> {
    setRunning('research')
    setStatus(STEP_STATUS.research)
    let settled = false
    let ok = false
    try {
      const res = await fetch(`/api/meeting-prep/${id}/research`, { method: 'POST' })
      if (res.status === 409) {
        const after = await waitWhile('researching')
        return Boolean(after && researchSectionsComplete(after.research_sections || {}) && after.stage !== 'failed')
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setPipelineError(d.error || 'Research failed. Please try again.')
        return false
      }
      patch({ stage: 'researching' })
      await readSSE(res, (e) => {
        if (e.error) {
          settled = true
          setPipelineError(String(e.error))
          patch({ stage: 'failed' })
        } else if (e.status === 'web_search_start') {
          setStatus('Searching the web for the latest information…')
        } else if (e.status === 'refining') {
          setStatus('Organising the research into sections…')
        } else if (e.done) {
          settled = true
          ok = true
          const u = e.usage as { tokens_total?: number; web_searches?: number; cost_usd?: number } | undefined
          // Research is stage 1: its usage replaces the session's.
          patch({
            research_sections: e.sections as MeetingPrepResearchSections,
            stage: 'awaiting_review',
            error: null,
            ...(u ? { tokens_total: u.tokens_total || 0, web_searches: u.web_searches || 0, cost_usd: u.cost_usd || 0 } : {}),
          })
        }
      })
    } catch {
      /* dropped: fall through to polling */
    }
    if (settled) return ok
    const after = await waitWhile('researching')
    if (!after) return false
    if (after.stage === 'failed') {
      setPipelineError(after.error || 'Research failed. Please try again.')
      return false
    }
    return researchSectionsComplete(after.research_sections || {})
  }

  // Points, planteo and the document are plain JSON routes. A 409 means
  // another request owns the step; a dropped connection may still have
  // finished on the server — both are settled by reading the session back.
  async function stepJson(step: Step, path: string, generating: MeetingPrepStage, next: MeetingPrepStage, apply: (d: Record<string, unknown>) => void): Promise<boolean> {
    setRunning(step)
    setStatus(STEP_STATUS[step])
    const r = await postJson(path)
    if (r.ok) {
      apply(r.data)
      patch({ stage: next, error: null })
      addUsage(r.data.usage as { tokens_total?: number; cost_usd?: number } | undefined)
      return true
    }
    if (r.status === 409 || r.status === 0) {
      const fresh = r.status === 409 ? await fetchSession() : null
      const after = fresh && fresh.stage !== generating ? fresh : await waitWhile(generating)
      if (!after) return false
      patch(after)
      if (after.error && PAUSED_STAGES.includes(after.stage)) {
        setPipelineError(after.error)
        return false
      }
      return after.stage !== 'failed'
    }
    const fresh = await fetchSession()
    if (fresh) patch(fresh)
    setPipelineError((r.data.error as string) || 'Something went wrong. Try again: nothing is lost.')
    return false
  }

  async function runPipeline(manual: boolean) {
    if (pipelineRef.current) return
    pipelineRef.current = true
    setPipelineError(null)
    setStalled(false)
    setStartedAt(Date.now())
    try {
      for (let guard = 0; guard < 8; guard++) {
        const st = sRef.current.stage
        let ok: boolean
        if (st === 'input' || st === 'failed') {
          ok = await stepResearch()
        } else if (GENERATING[st]) {
          setRunning(GENERATING[st]!)
          setStatus(STEP_STATUS[GENERATING[st]!])
          ok = Boolean(await waitWhile(st))
          // A page opened on a step another request was running carries on
          // only if this session runs by itself (or the user asked).
          if (ok && !manual && !sRef.current.auto_pipeline) break
        } else if (st === 'awaiting_review') {
          ok = await stepJson('points', '/points', 'points_generating', 'points_pending', (d) => patch({ presentation_points: d.points as string[] }))
        } else if (st === 'points_pending') {
          ok = await stepJson('planteo', '/planteo', 'planteo_generating', 'planteo_pending', (d) => patch({ planteo_output: d.planteo as string }))
        } else if (st === 'planteo_pending') {
          ok = await stepJson('final', '/final-document', 'final_generating', 'complete', (d) => patch({ final_sections: d.sections as MeetingPrepSession['final_sections'], final_output: d.output as string }))
        } else {
          break
        }
        // Never retry the same step in a loop: a step that "succeeded"
        // without moving the session on is left for the user to see.
        if (!ok || sRef.current.stage === st) break
      }
    } finally {
      pipelineRef.current = false
      setRunning(null)
    }
  }

  // ── On open ─────────────────────────────────────────────────────────────
  // New sessions (and any created since the one-scroll change) run through
  // to the finished document by themselves. An older session paused half-way
  // shows a button instead, so opening a page never spends on its own.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const cur = sRef.current
    if (cur.stage === 'input' || GENERATING[cur.stage]) {
      void runPipeline(false)
    } else if (cur.auto_pipeline && !cur.error && PAUSED_STAGES.includes(cur.stage)) {
      void runPipeline(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function retryStalled() {
    setResetting(true)
    try {
      const res = await fetch(`/api/meeting-prep/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetStalledStage: true }),
      })
      const fresh = await fetchSession()
      if (fresh) patch(fresh)
      if (res.ok || (fresh && !GENERATING[fresh.stage])) {
        setStalled(false)
        void runPipeline(true)
      } else {
        setActionError('Couldn’t reset the step. Please refresh the page.')
      }
    } finally {
      setResetting(false)
    }
  }

  // ── Block actions ───────────────────────────────────────────────────────

  async function saveBlock(key: FinalBlockKey, text: string) {
    const prev = finalSections
    patch({ final_sections: { ...prev, [key]: text.trim() } })
    setBlockUndo((u) => { const n = { ...u }; delete n[key]; return n })
    if (!(await patchSession({ finalBlock: key, finalBlockText: text }))) patch({ final_sections: prev })
  }

  async function regenerateBlock(key: FinalBlockKey, feedback: string, opts: { afterRecommendation?: boolean } = {}) {
    setBlockBusy(key)
    setActionError(null)
    const previous = finalSections[key] || ''
    try {
      // The CEO's recommended offer lives in the planteo and is shown in the
      // Commercial Alert: a request about it re-decides the recommendation
      // first, so the two never disagree.
      let note = feedback
      if (key === 'commercial_alert' && type === 'company_ceo' && feedback.trim() && !opts.afterRecommendation) {
        const prevPlanteo = sRef.current.planteo_output || ''
        const p = await postJson('/planteo', { feedback })
        if (!p.ok) throw new Error((p.data.error as string) || 'The recommendation couldn’t be updated.')
        patch({ planteo_output: p.data.planteo as string })
        setPlanteoUndo(prevPlanteo)
        addUsage(p.data.usage as { tokens_total?: number; cost_usd?: number })
        note = `${feedback}\n\n(The internal commercial recommendation in the approved planteo has just been updated for this request: show it exactly.)`
      } else if (key === 'commercial_alert' && !opts.afterRecommendation) {
        // The offer didn't change this time, so undoing this rewrite must not
        // roll it back to an earlier one.
        setPlanteoUndo(null)
      }
      const r = await postJson('/document/regenerate', { block: key, feedback: note })
      if (!r.ok) throw new Error((r.data.error as string) || 'This section couldn’t be rewritten. Please try again.')
      patch({ final_sections: { ...finalSectionsOf(sRef.current), [key]: r.data.text as string } })
      setBlockUndo((u) => ({ ...u, [key]: previous }))
      addUsage(r.data.usage as { tokens_total?: number; web_searches?: number; cost_usd?: number })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'This section couldn’t be rewritten.')
    } finally {
      setBlockBusy(null)
    }
  }

  async function undoBlock(key: FinalBlockKey) {
    const prev = blockUndo[key]
    if (prev === undefined) return
    await saveBlock(key, prev)
    // The offer behind Block 1 isn't shown any more, so it has to follow its undo.
    if (key === 'commercial_alert' && type === 'company_ceo') await undoPlanteo()
  }

  async function savePoint(index: number, text: string) {
    const updated = points.map((p, i) => (i === index ? text.trim() : p))
    patch({ presentation_points: updated })
    setPointUndo((u) => { const n = { ...u }; delete n[index]; return n })
    await patchSession({ presentationPoints: updated })
  }

  async function regeneratePoints(target: number | 'all', feedback: string) {
    setPointBusy(target)
    setActionError(null)
    const previous = points
    const r = await postJson('/points', { regenerateIndex: target === 'all' ? undefined : target, feedback })
    setPointBusy(null)
    if (!r.ok) {
      setActionError((r.data.error as string) || 'Couldn’t regenerate. Please try again.')
      return
    }
    patch({ presentation_points: r.data.points as string[] })
    if (target === 'all') setAllPointsUndo(previous)
    else setPointUndo((u) => ({ ...u, [target]: previous[target] || '' }))
    addUsage(r.data.usage as { tokens_total?: number; cost_usd?: number })
  }

  async function undoPoint(index: number) {
    const prev = pointUndo[index]
    if (prev === undefined) return
    const updated = points.map((p, i) => (i === index ? prev : p))
    patch({ presentation_points: updated })
    setPointUndo((u) => { const n = { ...u }; delete n[index]; return n })
    await patchSession({ presentationPoints: updated })
  }

  async function undoAllPoints() {
    if (!allPointsUndo) return
    patch({ presentation_points: allPointsUndo })
    setAllPointsUndo(null)
    await patchSession({ presentationPoints: allPointsUndo })
  }

  async function savePlanteo(output: string) {
    patch({ planteo_output: output })
    setPlanteoUndo(null)
    await patchSession({ planteoOutput: output })
  }

  async function regeneratePlanteo(feedback: string) {
    setPlanteoBusy(true)
    setActionError(null)
    const previous = planteo
    const r = await postJson('/planteo', { feedback })
    setPlanteoBusy(false)
    if (!r.ok) {
      setActionError((r.data.error as string) || 'Couldn’t regenerate the planteo. Please try again.')
      return
    }
    patch({ planteo_output: r.data.planteo as string })
    setPlanteoUndo(previous)
    addUsage(r.data.usage as { tokens_total?: number; cost_usd?: number })
    // A new CEO recommendation must also show in the Commercial Alert, so
    // the document never recommends one size in section 1 and another here.
    if (type === 'company_ceo' && sRef.current.stage === 'complete') {
      await regenerateBlock('commercial_alert', 'The internal commercial recommendation in the approved planteo has just been updated: show it exactly as it now stands.', { afterRecommendation: true })
    }
  }

  async function undoPlanteo() {
    if (planteoUndo === null) return
    const prev = planteoUndo
    patch({ planteo_output: prev })
    setPlanteoUndo(null)
    await patchSession({ planteoOutput: prev })
  }

  async function saveResearch(key: keyof MeetingPrepResearchSections, text: string) {
    const updated = { ...research, [key]: text }
    patch({ research_sections: updated })
    setResearchUndo((u) => { const n = { ...u }; delete n[key]; return n })
    await patchSession({ researchSections: updated })
  }

  async function regenerateResearch(key: keyof MeetingPrepResearchSections, feedback: string) {
    setResearchBusy(key)
    setActionError(null)
    const previous = research[key] || ''
    const r = await postJson('/research/regenerate', { section: key, feedback })
    setResearchBusy(null)
    if (!r.ok) {
      setActionError((r.data.error as string) || 'Couldn’t regenerate this section. Please try again.')
      return
    }
    patch({ research_sections: { ...(sRef.current.research_sections || {}), [key]: r.data.text as string } })
    setResearchUndo((u) => ({ ...u, [key]: previous }))
    addUsage(r.data.usage as { tokens_total?: number; web_searches?: number; cost_usd?: number })
  }

  async function undoResearch(key: keyof MeetingPrepResearchSections) {
    const prev = researchUndo[key]
    if (prev === undefined) return
    await saveResearch(key, prev)
  }

  // ── View ────────────────────────────────────────────────────────────────

  const steps: PipelineStep[] = [
    { key: 'research', label: 'Research', state: researchReady ? 'done' : running === 'research' ? 'running' : s.stage === 'failed' ? 'failed' : 'waiting' },
    { key: 'points', label: 'Presentation points', state: points.length ? 'done' : running === 'points' ? 'running' : 'waiting' },
    { key: 'planteo', label: 'Planteo', state: planteo ? 'done' : running === 'planteo' ? 'running' : 'waiting' },
    { key: 'final', label: 'Document', state: complete ? 'done' : running === 'final' ? 'running' : 'waiting' },
  ]
  const showProgress = !complete
  const paused = !pipelineActive && PAUSED_STAGES.includes(s.stage)
  const progressStatus = pipelineActive
    ? status
    : paused
        ? 'The rest of the document hasn’t been written yet.'
        : s.stage === 'failed'
          ? 'The research didn’t complete.'
          : 'Getting started…'

  const writing = (step: Step) => running === step
  const docLabel = (step: Step, what: string) =>
    writing(step) ? `Writing ${what}…` : running ? `${what[0].toUpperCase()}${what.slice(1)} comes next.` : `Not written yet.`

  const NAV_LABELS: Record<FinalBlockKey, string> = {
    commercial_alert: 'Space & alerts',
    snapshot: 'Snapshot',
    motivation: 'Motivations',
    said_recently: 'Said recently',
  }
  // Printed by code from the tracker: the record never goes through the model.
  const advertiserRecord = (
    <div className="prose-research rounded-xl bg-[#faf9f7] p-4 text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: renderMarkdown(advertiserRecordMarkdown(advertiser, type)) }} />
  )

  const nav: { id: string; label: string }[] = [
    { id: 'block-commercial_alert', label: NAV_LABELS.commercial_alert },
    { id: 'block-points', label: 'Why you' },
    { id: 'block-planteo', label: 'Planteo' },
    ...COLLAPSIBLE_BLOCKS.map((b) => ({ id: `block-${b.key}`, label: NAV_LABELS[b.key] })),
    { id: 'block-research', label: 'Full research' },
  ]

  const subjectDetails = (
    <>
          <div className="space-y-3.5">
            <InfoRow label="Title" value={s.interviewee_title} />
            <InfoRow label="Meeting type" value={interviewTypeLabel(type)} />
            <InfoRow label={type === 'company_ceo' ? 'Company' : 'Organisation'} value={s.company_org} />
            <InfoRow label="Country" value={s.company_country} />
            <InfoRow label="Publication" value={s.publication} />
            <InfoRow label="Publication Country" value={s.publication_country} />
          </div>

          <div className="mt-6 border-t border-[#e5e3df] pt-4">
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Advertiser History</p>
            <p className="whitespace-pre-line text-[13px] leading-snug text-gray-700">
              {s.advertiser_history_status === 'yes'
                ? s.advertiser_history_details
                : s.advertiser_history_status === 'no'
                  ? 'No previous advertising history on record.'
                  : 'Not aware / not checked.'}
            </p>
          </div>

          {(s.tokens_total || 0) > 0 && (
            <div className="mt-6 border-t border-[#e5e3df] pt-4">
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Usage</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Tokens</span>
                  <span className="font-medium tabular-nums text-gray-700">{formatTokens(s.tokens_total || 0)}</span>
                </div>
                {(s.web_searches || 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Searches</span>
                    <span className="font-medium tabular-nums text-gray-700">{s.web_searches}</span>
                  </div>
                )}
                {isAdmin && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Cost</span>
                    <span className="font-medium tabular-nums text-gray-700">${Number(s.cost_usd || 0).toFixed(4)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
    </>
  )

  return (
    <div className="bg-[#f0efec] lg:flex lg:h-full">
      <AiDisclaimerModal open={disclaimer.open} onClose={disclaimer.dismiss} />

      {/* Subject side panel */}
      <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-[#e5e3df] bg-white lg:flex">
        <div className="flex-1 overflow-y-auto p-5">
          <Link href="/commercial/meeting-preparation" className="inline-flex items-center gap-1.5 touch:py-2.5 text-xs text-gray-400 transition-colors hover:text-gray-700">
            <ArrowLeft size={13} />
            <span>Meeting Preparation</span>
          </Link>

          <div className="mt-5 flex items-center gap-2.5">
            <div className="flex-shrink-0 rounded-lg bg-black p-2 text-white">
              <CalendarClock size={15} />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Meeting prep</p>
          </div>
          <h1 className="mt-3 text-sm font-semibold leading-snug text-gray-900">{s.interviewee_name}</h1>

          <div className="mt-5">{subjectDetails}</div>
        </div>

        {isAdmin && (
          <div className="border-t border-[#e5e3df] p-5">
            <DeleteMeetingPrepButton sessionId={s.id} title={s.interviewee_name} redirectTo="/commercial/meeting-preparation" />
          </div>
        )}
      </aside>

      {/* The document: one scroll, every block always in view */}
      <div className="min-w-0 lg:flex-1 lg:overflow-y-auto">
        <div className="sticky top-14 z-10 border-b border-[#e5e3df] bg-[#f0efec]/95 backdrop-blur-sm lg:top-0">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2 sm:px-6 sm:py-2.5">
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {nav.map((n) => (
                <a key={n.id} href={`#${n.id}`} onClick={() => setOpenBlocks((o) => ({ ...o, [n.id]: true }))} className="flex-shrink-0 rounded-md px-2.5 py-1.5 touch:py-2.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-white hover:text-gray-900">
                  {n.label}
                </a>
              ))}
            </nav>
            {complete ? (
              <a
                href={`/api/meeting-prep/${id}/download`}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 touch:py-2.5 text-xs font-medium text-white shadow-sm hover:bg-gray-900"
              >
                <Download size={13} /> <span className="hidden sm:inline">Download .docx</span><span className="sm:hidden">.docx</span>
              </a>
            ) : (
              <span className="hidden flex-shrink-0 text-[11px] text-gray-400 sm:inline">Download when ready</span>
            )}
          </div>
        </div>

        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-6">
          <div className="flex items-center justify-between gap-3 lg:hidden">
            <Link href="/commercial/meeting-preparation" className="inline-flex items-center gap-1.5 touch:py-2.5 text-xs text-gray-400 hover:text-gray-700">
              <ArrowLeft size={13} /> Meeting Preparation
            </Link>
            <MobileDetailsToggle open={detailsOpen} onToggle={() => setDetailsOpen((v) => !v)} />
          </div>

          {detailsOpen && (
            <div className="rounded-2xl border border-[#e5e3df] bg-white p-4 lg:hidden">
              {subjectDetails}
              {isAdmin && (
                <div className="mt-5 border-t border-[#e5e3df] pt-4">
                  <DeleteMeetingPrepButton sessionId={s.id} title={s.interviewee_name} redirectTo="/commercial/meeting-preparation" />
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">{interviewTypeLabel(type)}</p>
            <h1 className="mt-1 text-lg font-semibold leading-tight text-gray-900">{s.interviewee_name}</h1>
            <p className="mt-0.5 text-sm text-gray-500">{[s.interviewee_title, s.company_org].filter(Boolean).join(' · ')} — for <span className="italic">{s.publication}</span></p>
          </div>

          {showProgress && (
            <PipelineProgress steps={steps} status={progressStatus} elapsedSecs={elapsed} running={pipelineActive} />
          )}

          {paused && !stalled && (
            <div className="flex flex-col gap-3 rounded-2xl border border-[#e5e3df] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-600">{pipelineError || 'Everything written so far is kept. Generate the rest to finish the document.'}</p>
              <button
                type="button"
                onClick={() => runPipeline(true)}
                className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900"
              >
                <Sparkles size={14} /> {pipelineError ? 'Try again' : 'Generate the rest of the document'}
              </button>
            </div>
          )}

          {/* Refused before anything ran (e.g. no token budget left on a new
              session): the paused and failed cards don't cover that stage. */}
          {pipelineError && !pipelineActive && !paused && s.stage !== 'failed' && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              <p className="flex items-start gap-2"><ShieldAlert size={16} className="mt-0.5 flex-shrink-0" />{pipelineError}</p>
              <button type="button" onClick={() => runPipeline(true)} className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-xs font-medium text-white hover:bg-red-800">
                <Sparkles size={14} /> Try again
              </button>
            </div>
          )}

          {s.stage === 'failed' && !pipelineActive && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              <p className="flex items-start gap-2"><ShieldAlert size={16} className="mt-0.5 flex-shrink-0" />{pipelineError || 'The research didn’t complete. Running it again is safe.'}</p>
              <button type="button" onClick={() => runPipeline(true)} className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-xs font-medium text-white hover:bg-red-800">
                <Sparkles size={14} /> Run it again
              </button>
            </div>
          )}

          {stalled && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
              <p>This is taking much longer than expected; the request may have been interrupted. You can retry this step without losing anything already written.</p>
              <button type="button" onClick={retryStalled} disabled={resetting} className="inline-flex items-center gap-2 rounded-lg bg-amber-800 px-4 py-2 text-xs font-medium text-white hover:bg-amber-900 disabled:opacity-50">
                {resetting ? 'Resetting…' : 'Retry this step'}
              </button>
            </div>
          )}

          {actionError && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" />
              <p className="flex-1">{actionError}</p>
              <button type="button" onClick={() => setActionError(null)} className="text-red-400 hover:text-red-700" aria-label="Dismiss"><X size={15} /></button>
            </div>
          )}

          {/* 1: what to pitch, always open */}
          <MarkdownBlock
            id="block-commercial_alert"
            number={1}
            title={finalBlockTitle('commercial_alert', type)}
            text={finalSections.commercial_alert || ''}
            lead={showsMinisterGuidance(type) ? (
              <div className="mb-4 flex flex-col gap-3">
                <div className="prose-research rounded-xl border-l-4 border-[#c8973f] bg-[#fbf7ed] p-4 text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: renderMarkdown(MINISTER_GUIDANCE) }} />
                {advertiserRecord}
              </div>
            ) : undefined}
            trail={showsMinisterGuidance(type) ? undefined : <div className="mt-4">{advertiserRecord}</div>}
            placeholder={complete ? undefined : <BlockPlaceholder writing={writing('final')} label={docLabel('final', 'this section')} />}
            disabled={anyBusy && blockBusy !== 'commercial_alert'}
            busy={blockBusy === 'commercial_alert'}
            canUndo={blockUndo.commercial_alert !== undefined}
            onSave={(t) => saveBlock('commercial_alert', t)}
            onRegenerate={(fb) => regenerateBlock('commercial_alert', fb)}
            onUndo={() => undoBlock('commercial_alert')}
            emptyAction="Write this section"
            regeneratePlaceholder={type === 'company_ceo' ? 'e.g. Recommend a Half Page: revenue is closer to $80M.' : 'e.g. Add that they took part in the 2024 report.'}
            regenerateHint="Searches the web only if your request needs information the research doesn’t have."
          />

          {/* 2: presentation points, always open */}
          <PointsBlock
            id="block-points"
            number={POINTS_NUMBER}
            title={POINTS_TITLE}
            points={points}
            placeholder={<BlockPlaceholder writing={writing('points')} label={docLabel('points', 'the three presentation points')} />}
            disabled={anyBusy && pointBusy === null}
            busy={pointBusy}
            pointUndo={pointUndo}
            allUndo={allPointsUndo}
            onSave={savePoint}
            onRegenerate={regeneratePoints}
            onUndoPoint={undoPoint}
            onUndoAll={undoAllPoints}
          />

          {/* 3: planteo, with the recording directly under the script, always open */}
          {planteo ? (
            <PlanteoBlock
              id="block-planteo"
              number={PLANTEO_NUMBER}
              title={PLANTEO_TITLE}
              type={type}
              planteoOutput={planteo}
              librarySnapshot={s.planteo_library_snapshot}
              recordingUrl={recordingUrl}
              samples={samples}
              isAdmin={isAdmin}
              disabled={anyBusy && !planteoBusy}
              busy={planteoBusy}
              canUndo={planteoUndo !== null}
              onSaveOutput={savePlanteo}
              onRegenerate={regeneratePlanteo}
              onUndo={undoPlanteo}
            />
          ) : (
            <section id="block-planteo" className="scroll-mt-20 rounded-2xl border border-[#c8973f]/35 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">{PLANTEO_NUMBER}</span>
                <h2 className="text-base font-semibold leading-tight text-gray-900">{PLANTEO_TITLE}</h2>
              </div>
              <div className="mt-4"><BlockPlaceholder writing={writing('planteo')} label={docLabel('planteo', 'the planteo')} /></div>
            </section>
          )}

          {/* 4–6: collapsed until opened, as asked by the CEO */}
          {COLLAPSIBLE_BLOCKS.map((b) => (
            <MarkdownBlock
              key={b.key}
              id={`block-${b.key}`}
              number={b.number}
              title={finalBlockTitle(b.key, type)}
              subtitle={!finalSections[b.key] && writing('final') ? 'Being written…' : undefined}
              collapsed={!openBlocks[`block-${b.key}`]}
              onToggle={() => toggleBlock(`block-${b.key}`)}
              text={finalSections[b.key] || ''}
              placeholder={complete ? undefined : <BlockPlaceholder writing={writing('final')} label={docLabel('final', 'this section')} />}
              disabled={anyBusy && blockBusy !== b.key}
              busy={blockBusy === b.key}
              canUndo={blockUndo[b.key] !== undefined}
              onSave={(t) => saveBlock(b.key, t)}
              onRegenerate={(fb) => regenerateBlock(b.key, fb)}
              onUndo={() => undoBlock(b.key)}
              emptyAction="Write this section"
              regeneratePlaceholder={b.key === 'said_recently' ? 'e.g. Find a more recent quote on their export plans.' : 'e.g. Shorter, and lead with their international expansion.'}
              regenerateHint="Searches the web only if your request needs information the research doesn’t have."
            />
          ))}

          {/* The research behind the document */}
          <section id="block-research" className="scroll-mt-20 rounded-2xl border border-[#e5e3df] bg-white/70 shadow-sm">
            <button
              type="button"
              onClick={() => toggleBlock('block-research')}
              className="flex w-full items-center justify-between gap-3 p-5 text-left sm:p-6"
              aria-expanded={researchOpen}
            >
              <div>
                <h2 className="text-base font-semibold text-gray-900">Full research behind this document</h2>
                <p className="mt-1 text-xs text-gray-500">
                  {researchReady ? 'Four sections, with every source. Edit or regenerate any of them.' : running === 'research' ? 'Researching now…' : 'Appears here once the research is done.'}
                </p>
              </div>
              <ChevronDown size={18} className={`flex-shrink-0 text-gray-400 transition-transform ${researchOpen ? '' : '-rotate-90'}`} />
            </button>
            {researchOpen && (
              <div className="flex flex-col gap-4 px-4 pb-5 sm:px-6">
                {RESEARCH_ORDER.map((key) => {
                  const Icon = RESEARCH_ICONS[key]
                  return (
                    <MarkdownBlock
                      key={key}
                      id={`research-${key}`}
                      title={RESEARCH_LABELS[key]}
                      headerRight={<Icon size={16} className="text-gray-300" />}
                      text={research[key] || ''}
                      placeholder={researchReady ? undefined : <BlockPlaceholder writing={writing('research')} label={writing('research') ? 'Researching…' : 'Not researched yet.'} />}
                      disabled={anyBusy && researchBusy !== key}
                      busy={researchBusy === key}
                      canUndo={researchUndo[key] !== undefined}
                      onSave={(t) => saveResearch(key, t)}
                      onRegenerate={(fb) => regenerateResearch(key, fb)}
                      onUndo={() => undoResearch(key)}
                      regeneratePlaceholder="e.g. Focus more on their international expansion plans. Find stronger recent quotes."
                      regenerateHint="Searches the web again for this section only. The document above isn’t changed; regenerate a block there to use the new research."
                    />
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
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
