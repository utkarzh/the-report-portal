'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { marked } from 'marked'
import { useStickToBottom } from '@/lib/use-stick-to-bottom'
import {
  Upload as UploadIcon,
  FileText,
  Trash2,
  CheckCircle2,
  RefreshCw,
  Search,
  Send,
  Download,
  Copy,
  BookOpen,
  ArrowLeft,
  AlertTriangle,
  Eye,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import StatusPill from '@/components/ui/StatusPill'
import ResearchLedgerModal from '@/components/copywriting/ResearchLedgerModal'
import ResearchRequestPanel from '@/components/copywriting/ResearchRequestPanel'
import FileViewerModal from '@/components/copywriting/FileViewerModal'
import ArticleWithImages from '@/components/copywriting/ArticleWithImages'
import { uploadToStorage, type StagedFile } from '@/lib/copywriting-upload'
import CopywritingLoader, { type CopywritingLoaderVariant } from '@/components/copywriting/CopywritingLoader'
import AiDisclaimerModal from '@/components/ui/AiDisclaimerModal'
import {
  ANALYSIS_SECTION_ORDER,
  ANALYSIS_SECTION_LABELS,
  analysisAllApproved,
  splitGapLines,
  splitArticleImages,
  maxUploadableSlot,
  isStalledStage,
  IN_PROGRESS_STAGE_ENTRY,
  STAGE_LABELS,
  CHECK_ITEM_LABELS,
  COPYWRITING_UPLOAD_ACCEPT,
  COPYWRITING_UPLOAD_EXT_RE,
  PROJECT_DOCUMENTS_BUCKET,
} from '@/lib/copywriting'
import type {
  CopywritingProject,
  CopywritingProjectDocument,
  CopywritingResearchEntry,
  CopywritingMessage,
  CopywritingProjectEvent,
  CopywritingAnalysis,
  CopywritingProjectImage,
} from '@/types'

marked.use({ gfm: true, breaks: true })

// AI output (markdown) rendered through the
// same marked + .prose-research pipeline the other modules use.
function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`prose-research text-sm text-gray-700 ${className}`} dangerouslySetInnerHTML={{ __html: marked.parse(text || '') as string }} />
}

// Strips inline markdown (**bold**, *italic*, `code`, leading #) for places
// that show a single line as plain text — gap checkboxes, check items.
function plainLine(line: string): string {
  return line.replace(/^#+\s*/, '').replace(/(\*\*\*|\*\*|\*|__|`)(.+?)\1/g, '$2').trim()
}

// Markdown → plain text: markers removed, headings/paragraphs kept on their
// own lines. Used as the text/plain half of the article copy.
function markdownToPlainText(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l))
    .map((l) => plainLine(l.replace(/^(\s*)[-*]\s+/, '$1• ')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Inline styles mirroring .prose-research + the Markdown wrapper's text-sm
// (globals.css), in pt so Word/Docs reproduce them exactly: without these the
// paste target applies its own Heading 1/3 sizes and paragraph spacing.
// 1px = 0.75pt; base text 14px, rem = 16px.
// Arial, same as the Word download: Inter (the app font) is rarely installed,
// and Word shows a substitute for a missing first-choice font.
const COPY_FONT = "Arial, Helvetica, sans-serif"
const COPY_STYLES: Record<string, string> = {
  h1: 'font-size:13.5pt;font-weight:600;color:#111111;margin:18pt 0 6pt;line-height:1.3;',
  h2: 'font-size:12pt;font-weight:600;color:#111111;margin:18pt 0 6pt;line-height:1.3;border-bottom:1px solid #e5e3df;padding-bottom:4pt;',
  h3: 'font-size:11.25pt;font-weight:600;color:#111111;margin:18pt 0 6pt;line-height:1.3;',
  h4: 'font-size:10.5pt;font-weight:600;color:#111111;margin:18pt 0 6pt;line-height:1.3;',
  p: 'font-size:10.5pt;font-weight:400;color:#374151;margin:0 0 9pt;line-height:1.75;',
  ul: 'margin:0 0 9pt;padding-left:16.8pt;',
  ol: 'margin:0 0 9pt;padding-left:16.8pt;',
  li: 'font-size:10.5pt;font-weight:400;color:#374151;margin:0 0 3.6pt;line-height:1.65;',
  strong: 'font-weight:600;',
  em: 'font-style:italic;',
}

function styledArticleHtml(md: string): string {
  const doc = new DOMParser().parseFromString(`<div>${marked.parse(md) as string}</div>`, 'text/html')
  const root = doc.body.firstElementChild as HTMLElement
  root.querySelectorAll<HTMLElement>(Object.keys(COPY_STYLES).join(',')).forEach((el) => {
    el.setAttribute('style', `font-family:${COPY_FONT};${COPY_STYLES[el.tagName.toLowerCase()]}`)
  })
  // No leading gap before the first element when pasted at the top of a doc.
  const first = root.firstElementChild as HTMLElement | null
  if (first) first.style.marginTop = '0'
  root.setAttribute('style', `font-family:${COPY_FONT};font-size:10.5pt;color:#374151;`)
  return `<meta charset="utf-8">${root.outerHTML}`
}

// Copies the article so it pastes the way it looks on screen: rich HTML with
// the page's own heading sizes and spacing for Word / Google Docs / email,
// plus a clean plain-text version (no # or ** markers) for plain-text fields.
async function copyArticle(md: string) {
  const html = styledArticleHtml(md)
  const plain = markdownToPlainText(md)
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ])
  } catch {
    // Older browsers / no rich-clipboard permission: plain text only.
    await navigator.clipboard.writeText(plain)
  }
}

// Actions whose result is new AI-written content the writer is about to read.
const AI_RESULT_ACTIONS = new Set(['analyze', 'regenerate_section', 'plan', 'replan', 'draft'])

const normClaim = (c: string) => c.trim().toLowerCase()

// Facts the writer model flagged as missing in the LATEST draft/refine that
// haven't been sent to research since. Read from the project event log (the
// draft/revision events carry `flaggedGaps`, research_run events carry the
// `claims` sent), so the list survives a page reload.
function outstandingFlaggedGaps(events: CopywritingProjectEvent[]): string[] {
  let idx = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event_type === 'draft_generated' || events[i].event_type === 'draft_revised') {
      idx = i
      break
    }
  }
  if (idx === -1) return []
  const gaps = (events[idx].payload?.flaggedGaps as string[] | undefined) || []
  const researched = new Set(
    events
      .slice(idx + 1)
      .filter((e) => e.event_type === 'research_run')
      .flatMap((e) => ((e.payload?.claims as string[] | undefined) || []).map(normClaim)),
  )
  return gaps.filter((g) => !researched.has(normClaim(g)))
}

// The refine message that works newly approved research into the draft.
function applyResearchMessage(entries: CopywritingResearchEntry[]): string {
  const list = entries.map((e, i) => `${i + 1}. ${e.claim}${e.source_url ? ` (source: ${e.source_url})` : ''}`).join('\n')
  return `Update the draft to include these newly approved research findings:\n${list}\n\nWork each one in where it fits naturally. Keep the rest of the draft as it is unless a finding contradicts it.`
}

interface Props {
  projectId: string
  initial: {
    project: CopywritingProject
    documents: CopywritingProjectDocument[]
    research: CopywritingResearchEntry[]
    messages: CopywritingMessage[]
    events: CopywritingProjectEvent[]
    images: CopywritingProjectImage[]
  }
  isAdmin: boolean
}

export default function ProjectWorkspace({ projectId, initial, isAdmin }: Props) {
  const router = useRouter()
  const [project, setProject] = useState(initial.project)
  const [documents, setDocuments] = useState(initial.documents)
  const [research, setResearch] = useState(initial.research)
  const [messages, setMessages] = useState(initial.messages)
  const [events, setEvents] = useState(initial.events)
  const [images, setImages] = useState(initial.images)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/copywriting/${projectId}`)
    if (!res.ok) return
    const data = await res.json()
    setProject(data.project)
    setDocuments(data.documents)
    setResearch(data.research)
    setMessages(data.messages)
    setEvents(data.events)
    setImages(data.images || [])
  }, [projectId])

  // "AI-generated — verify before publication" popup, shown every time new
  // AI output lands on screen (not when a step starts, and not for the
  // automated check, which runs on its own after every draft/refine).
  const [disclaimerOpen, setDisclaimerOpen] = useState(false)
  const showDisclaimer = useCallback(() => setDisclaimerOpen(true), [])

  async function runAction(action: string, body: Record<string, unknown> = {}) {
    setBusy(action)
    setError(null)
    const res = await fetch(`/api/copywriting/${projectId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return null
    }
    await refresh()
    if (AI_RESULT_ACTIONS.has(action)) showDisclaimer()
    return data
  }

  // After a research run lands, scroll up to the Research Ledger button and
  // flash it so the writer sees where the new findings went.
  const ledgerRef = useRef<HTMLButtonElement>(null)
  const [ledgerHighlighted, setLedgerHighlighted] = useState(false)

  useEffect(() => {
    if (!ledgerHighlighted) return
    const t = setTimeout(() => setLedgerHighlighted(false), 2500)
    return () => clearTimeout(t)
  }, [ledgerHighlighted])

  function highlightLedger() {
    ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setLedgerHighlighted(true)
  }

  // Approved research the current draft doesn't use yet (placement is
  // computed in code after every draft/refine/approval — lib/copywriting-ledger.ts).
  const unusedApproved = research.filter((r) => r.status === 'approved' && (!r.placement || r.placement === 'Not used in draft'))
  const flaggedGaps = outstandingFlaggedGaps(events)
  // Bumped by the ledger's "Update draft" button; DraftStage runs the refine.
  const [applySignal, setApplySignal] = useState(0)

  async function runResearch(claims: string[]) {
    setBusy('research')
    setError(null)
    const res = await fetch(`/api/copywriting/${projectId}/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claims }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) setError(data.error || 'Research failed')
    await refresh()
    if (res.ok) {
      highlightLedger()
      showDisclaimer()
    }
  }

  async function approve(type: string, section?: string) {
    setBusy(`approve_${type}_${section || ''}`)
    setError(null)
    const res = await fetch(`/api/copywriting/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, section }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return
    }
    await refresh()
  }

  // A step started elsewhere (another tab, or before a page reload) shows as an
  // in-progress stage with no request running here: poll until it settles,
  // and if it has stalled (request killed mid-run), offer a retry instead of
  // an endless loader. See isStalledStage() in lib/copywriting.ts.
  const inProgressStage = project.stage in IN_PROGRESS_STAGE_ENTRY
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!inProgressStage || busy) return
    const t = setInterval(() => {
      setNow(Date.now())
      refresh()
    }, 5000)
    return () => clearInterval(t)
  }, [inProgressStage, busy, refresh])
  const stalled = !busy && isStalledStage(project, now)

  const aiStage: CopywritingLoaderVariant | null =
    busy === 'analyze' || (project.stage === 'analyzing' && !stalled) ? 'analyze'
    : busy === 'plan' || (project.stage === 'plan_generating' && !stalled) ? 'plan'
    : busy === 'draft' || (project.stage === 'drafting' && !stalled) ? 'draft'
    : null
  const stalledAction = project.stage === 'analyzing' ? 'analyze' : project.stage === 'plan_generating' ? 'plan' : 'draft'

  // ── Step navigation: completed steps stay viewable (read-only) ──────────
  const currentStep = currentStepFor(project.stage)
  const availableSteps = STEPS.filter((st) => st.key === currentStep || stepHasContent(st.key, project, documents))
  const [viewStep, setViewStep] = useState<StepKey | null>(null)
  const viewing = viewStep !== null && viewStep !== currentStep ? viewStep : null
  // A step change (e.g. Submit & Plan finishing) returns to the live step.
  useEffect(() => { setViewStep(null) }, [currentStep])

  const stepNav = (
    <StepNav
      stage={project.stage}
      current={currentStep}
      available={availableSteps.map((st) => st.key)}
      viewing={viewing}
      onView={(k) => setViewStep(k === currentStep ? null : k)}
    />
  )
  const pastView = viewing && (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs text-amber-900">
          You’re viewing the <span className="font-semibold">{STEPS.find((st) => st.key === viewing)?.label}</span> step as it was approved — read-only.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setViewStep(null)}>
          Back to current step
        </Button>
      </div>
      <PastStepView step={viewing} project={project} documents={documents} images={images} />
    </>
  )

  if (project.stage === 'complete') {
    return (
      <div className="max-w-5xl mx-auto">
        {stepNav}
        {viewing ? <div className="mb-8">{pastView}</div> : <div className="mt-6" />}
        {!viewing && (
      <CompletedView
        project={project}
        events={events}
        research={research}
        onOpenLedger={() => setLedgerOpen(true)}
        ledgerOpen={ledgerOpen}
        setLedgerOpen={setLedgerOpen}
        researchAll={research}
        images={images}
        onImagesChange={setImages}
      />
        )}
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {stepNav}

      {error && (
        <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {project.error && !error && (
        <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <p>Last attempt failed: {project.error}</p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end">
        <button
          ref={ledgerRef}
          onClick={() => setLedgerOpen(true)}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium tracking-wider uppercase transition-all duration-700 ${ledgerHighlighted ? 'bg-amber-50 text-black ring-2 ring-amber-300' : 'text-gray-500 hover:text-black ring-0'}`}
        >
          <BookOpen size={14} />
          Research Ledger ({research.length})
        </button>
      </div>

      {pastView}

      {!viewing && (
        <>
      {/* While Analyze / Plan / Draft runs, the whole stage is replaced by the
          animated loader — driven by the in-flight action too, since the
          project's saved stage only updates when the call returns. */}
      {aiStage && <CopywritingLoader variant={aiStage} />}

      {stalled && (
        <div className="mt-8 flex flex-col items-center gap-4 border border-amber-200 bg-amber-50 px-6 py-10 text-center">
          <AlertTriangle size={20} className="text-amber-600" />
          <div>
            <p className="text-sm font-medium text-gray-900">This step stopped before it finished</p>
            <p className="mt-1 text-xs text-gray-600">
              The {stalledAction === 'analyze' ? 'analysis' : stalledAction} didn’t complete — usually the request ran out of time. Nothing was saved from it, so you can safely run it again.
            </p>
          </div>
          <Button size="sm" onClick={() => runAction(stalledAction)}>
            <RefreshCw size={13} className="mr-1.5 inline" /> Retry
          </Button>
        </div>
      )}

      {!aiStage && (project.stage === 'upload' || project.stage === 'failed') && (
        <UploadStage
          documents={documents}
          projectId={projectId}
          ownerId={project.user_id}
          onUploaded={refresh}
          onStartAnalyzing={() => runAction('analyze')}
          busy={busy === 'analyze'}
        />
      )}

      {!aiStage && project.stage === 'analysis_review' && project.analysis && (
        <AnalysisStage
          analysis={project.analysis}
          research={research}
          busy={busy}
          onApproveSection={(section) => approve('analysis_section', section)}
          onRegenerate={(section, feedback) => runAction('regenerate_section', { section, feedback })}
          onStartResearch={runResearch}
          onSubmitPlan={() => runAction('plan')}
        />
      )}

      {!aiStage && project.stage === 'plan_review' && (
        <PlanStage
          planOutput={project.plan_output || ''}
          planStatus={project.plan_status}
          busy={busy}
          onApprove={() => approve('plan')}
          onRequestChanges={(feedback) => runAction('replan', { feedback })}
          onDraft={() => runAction('draft')}
        />
      )}

      {!aiStage && project.stage === 'draft_review' && (
        <DraftStage
          project={project}
          images={images}
          onImagesChange={setImages}
          messages={messages}
          busy={busy}
          isAdmin={isAdmin}
          onRunCheck={() => runAction('check')}
          onRevised={refresh}
          onError={setError}
          flaggedGaps={flaggedGaps}
          unusedApproved={unusedApproved}
          applySignal={applySignal}
          onOpenLedger={() => setLedgerOpen(true)}
          onAiResult={showDisclaimer}
          onApproveFinal={async () => {
            setBusy('approve_final')
            setError(null)
            const res = await fetch(`/api/copywriting/${projectId}/approve`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'final' }),
            })
            const data = await res.json().catch(() => ({}))
            setBusy(null)
            if (!res.ok) return setError(data.error || 'Could not approve')
            router.refresh()
            await refresh()
          }}
          onStartResearch={runResearch}
        />
      )}

        </>
      )}

      <ResearchLedgerModal
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        entries={research}
        onChanged={refresh}
        projectId={projectId}
        onAiResult={showDisclaimer}
        // Only once a draft exists: Plan and Draft already read every
        // approved finding, so before that there's nothing to "update".
        applyCount={project.stage === 'draft_review' ? unusedApproved.length : 0}
        onApplyApproved={() => { setLedgerOpen(false); setApplySignal((n) => n + 1) }}
      />
      <AiDisclaimerModal open={disclaimerOpen} onClose={() => setDisclaimerOpen(false)} />
    </div>
  )
}

// ── Step navigation ──────────────────────────────────────────────────────
type StepKey = 'sources' | 'analysis' | 'plan' | 'draft' | 'final'

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'sources', label: 'Sources' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'plan', label: 'Plan' },
  { key: 'draft', label: 'Draft' },
  { key: 'final', label: 'Final' },
]

function currentStepFor(stage: string): StepKey {
  if (stage === 'analysis_review' || stage === 'plan_generating') return 'analysis'
  if (stage === 'plan_review' || stage === 'drafting') return 'plan'
  if (stage === 'draft_review') return 'draft'
  if (stage === 'complete') return 'final'
  return 'sources' // upload, analyzing, failed
}

function stepHasContent(step: StepKey, project: CopywritingProject, documents: CopywritingProjectDocument[]): boolean {
  if (step === 'sources') return documents.length > 0
  if (step === 'analysis') return !!project.analysis
  if (step === 'plan') return !!project.plan_output
  if (step === 'draft') return !!project.draft_text
  return project.stage === 'complete'
}

// Clickable stepper: done steps open a read-only view, the current step is
// the live workspace, future steps are disabled.
function StepNav({
  stage,
  current,
  available,
  viewing,
  onView,
}: {
  stage: string
  current: StepKey
  available: StepKey[]
  viewing: StepKey | null
  onView: (k: StepKey) => void
}) {
  const currentIdx = STEPS.findIndex((st) => st.key === current)
  return (
    <div>
      <p className="mb-3 text-xs font-medium text-gray-700">{STAGE_LABELS[stage] || stage}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((st, i) => {
          const isCurrent = st.key === current
          const isDone = i < currentIdx
          const enabled = available.includes(st.key)
          const isViewed = viewing ? viewing === st.key : isCurrent
          return (
            <div key={st.key} className="flex items-center gap-1.5">
              {i > 0 && <span className={`h-px w-4 sm:w-8 ${i <= currentIdx ? 'bg-gray-400' : 'bg-gray-200'}`} />}
              <button
                onClick={() => enabled && onView(st.key)}
                disabled={!enabled}
                title={!enabled ? (i > currentIdx ? 'Not reached yet' : 'Nothing saved for this step') : isCurrent ? 'Current step' : `View the ${st.label} step (read-only)`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  isViewed
                    ? 'border-black bg-black text-white'
                    : isDone && enabled
                      ? 'border-[#e5e3df] bg-white text-gray-700 hover:border-gray-400'
                      : 'border-[#e5e3df] bg-white text-gray-400'
                } disabled:cursor-not-allowed`}
              >
                {isDone ? <CheckCircle2 size={12} className={isViewed ? 'text-white' : 'text-emerald-600'} /> : <span className="tabular-nums">{i + 1}</span>}
                {st.label}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Read-only snapshot of an earlier step, as it stands now (approved content).
function PastStepView({
  step,
  project,
  documents,
  images,
}: {
  step: StepKey
  project: CopywritingProject
  documents: CopywritingProjectDocument[]
  images: CopywritingProjectImage[]
}) {
  if (step === 'sources') {
    return <PastSourcesView project={project} documents={documents} />
  }
  return <PastStepBody step={step} project={project} images={images} />
}

// Read-only list of the uploaded sources, each viewable.
function PastSourcesView({ project, documents }: { project: CopywritingProject; documents: CopywritingProjectDocument[] }) {
  const [viewing, setViewing] = useState<string | null>(null)
  return (
      <div className="mt-6 bg-white border border-[#e5e3df] p-6 sm:p-8">
        <h2 className="text-sm font-semibold text-gray-900">Uploaded sources ({documents.length})</h2>
        <div className="mt-4 flex flex-col gap-2">
          {documents.map((d) => (
            <div key={d.id} className="flex items-center gap-2 border border-[#e5e3df] px-3 py-2.5 text-sm text-gray-700">
              <FileText size={14} className="flex-shrink-0 text-gray-400" />
              <span className="truncate">{d.filename}</span>
              {d.truncated && <span className="flex-shrink-0 text-[10px] text-amber-600">(truncated)</span>}
              <button onClick={() => setViewing(d.id)} className="ml-auto inline-flex flex-shrink-0 items-center gap-1 text-xs text-gray-500 hover:text-black">
                <Eye size={14} /> View
              </button>
            </div>
          ))}
        </div>
        <FileViewerModal endpoint={viewing ? `/api/copywriting/${project.id}/sources?documentId=${viewing}` : null} onClose={() => setViewing(null)} />
      </div>
  )
}

function PastStepBody({
  step,
  project,
  images,
}: {
  step: StepKey
  project: CopywritingProject
  images: CopywritingProjectImage[]
}) {
  if (step === 'analysis') {
    const analysis = project.analysis as CopywritingAnalysis | null
    return (
      <div className="mt-6 flex flex-col gap-5">
        {ANALYSIS_SECTION_ORDER.map((key) => {
          const section = analysis?.[key]
          if (!section) return null
          return (
            <div key={key} className="bg-white border border-[#e5e3df] p-6">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">{ANALYSIS_SECTION_LABELS[key]}</h3>
                {key !== 'style_theme' && (section.approved ? <StatusPill label="Approved" tone="emerald" /> : <StatusPill label="Pending" tone="amber" />)}
              </div>
              <Markdown text={section.text} className="mt-3" />
            </div>
          )
        })}
      </div>
    )
  }
  if (step === 'plan') {
    return (
      <div className="mt-6 bg-white border border-[#e5e3df] p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Article plan</h2>
          {project.plan_status === 'approved' && <StatusPill label="Approved" tone="emerald" />}
        </div>
        <Markdown text={project.plan_output || ''} className="mt-3" />
      </div>
    )
  }
  // draft
  return (
    <div className="mt-6 bg-white border border-[#e5e3df] p-6 sm:p-8">
      <h2 className="text-sm font-semibold text-gray-900">Draft</h2>
      <ArticleWithImages
        projectId={project.id}
        ownerId={project.user_id}
        markdown={project.draft_text || ''}
        images={images}
        imageCount={project.image_count}
        editable={false}
        onImagesChange={() => {}}
        className="mt-3"
      />
    </div>
  )
}

// ── Upload ───────────────────────────────────────────────────────────────
function UploadStage({
  documents,
  projectId,
  ownerId,
  onUploaded,
  onStartAnalyzing,
  busy,
}: {
  documents: CopywritingProjectDocument[]
  projectId: string
  ownerId: string | null
  onUploaded: () => Promise<void>
  onStartAnalyzing: () => void
  busy: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)

  async function handleUpload() {
    if (!pendingFiles.length) return
    setUploading(true)
    setUploadError(null)
    // 1. Each file goes straight from the browser to Supabase Storage (the
    //    project owner's folder), like the Transcriptions module — no file
    //    bytes through our API, so no ~4.5 MB Vercel request limit.
    // 2. The API gets only the paths, extracts the text and records each one.
    const staged: StagedFile[] = []
    const failures: string[] = []
    for (const f of pendingFiles) {
      if (!COPYWRITING_UPLOAD_EXT_RE.test(f.name)) {
        failures.push(`${f.name}: Unsupported file type`)
        continue
      }
      try {
        staged.push(await uploadToStorage(PROJECT_DOCUMENTS_BUCKET, `${ownerId}/${projectId}`, f))
      } catch (e) {
        failures.push(`${f.name}: ${e instanceof Error ? e.message : 'Upload failed'}`)
      }
    }
    if (staged.length) {
      const res = await fetch(`/api/copywriting/${projectId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: staged }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.errors?.length) failures.push(...data.errors.map((e: { filename: string; error: string }) => `${e.filename}: ${e.error}`))
      else if (!res.ok) failures.push(data.error || 'Upload failed')
    }
    setUploading(false)
    if (failures.length) setUploadError(failures.join('; '))
    setPendingFiles([])
    await onUploaded()
  }

  async function removeDoc(id: string) {
    await fetch(`/api/copywriting/${projectId}/sources?documentId=${id}`, { method: 'DELETE' })
    await onUploaded()
  }

  return (
    <div className="mt-8 bg-white border border-[#e5e3df] p-6 sm:p-8">
      <h2 className="text-sm font-semibold text-gray-900">Upload sources</h2>
      <p className="text-xs text-gray-500 mt-1 max-w-xl">
        Add everything this article should be built from: interview transcripts, press releases, company or
        government material, supporting documents, and any instructions specific to this article.
      </p>

      <label className="mt-6 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#e5e3df] rounded-lg py-10 cursor-pointer hover:border-gray-400 transition-colors">
        <UploadIcon size={20} className="text-gray-400" />
        <span className="text-sm text-gray-600">Click to choose files, or drag them here</span>
        <span className="text-[10px] text-gray-400">.docx, .pdf, .xlsx, .txt, .md</span>
        <input
          type="file"
          multiple
          accept={COPYWRITING_UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => setPendingFiles(Array.from(e.target.files || []))}
        />
      </label>

      {pendingFiles.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {pendingFiles.map((f, i) => (
            <div key={i} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded">
              <span className="truncate">{f.name}</span>
              <button onClick={() => setPendingFiles((p) => p.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <Button size="sm" onClick={handleUpload} loading={uploading} className="self-start">Upload</Button>
        </div>
      )}
      {uploadError && <p className="mt-2 text-xs text-red-500">{uploadError}</p>}

      {documents.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Uploaded ({documents.length})</p>
          {documents.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 border border-[#e5e3df] px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2 min-w-0 text-gray-700">
                <FileText size={14} className="flex-shrink-0 text-gray-400" />
                <span className="truncate">{d.filename}</span>
                {d.truncated && <span className="flex-shrink-0 text-[10px] text-amber-600">(truncated)</span>}
              </span>
              <span className="flex flex-shrink-0 items-center gap-3">
                <button onClick={() => setViewing(d.id)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black">
                  <Eye size={14} /> View
                </button>
                <button onClick={() => removeDoc(d.id)} className="text-gray-400 hover:text-red-500" aria-label="Remove">
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <Button onClick={onStartAnalyzing} loading={busy} disabled={documents.length === 0} disabledReason="Upload at least one source document first" arrow>
          Start Analyzing
        </Button>
      </div>

      <FileViewerModal endpoint={viewing ? `/api/copywriting/${projectId}/sources?documentId=${viewing}` : null} onClose={() => setViewing(null)} />
    </div>
  )
}

// ── Analyze Sources & Styles review ─────────────────────────────────────
function AnalysisStage({
  analysis,
  research,
  busy,
  onApproveSection,
  onRegenerate,
  onStartResearch,
  onSubmitPlan,
}: {
  analysis: CopywritingAnalysis
  research: CopywritingResearchEntry[]
  busy: string | null
  onApproveSection: (section: string) => void
  onRegenerate: (section: string, feedback: string) => void
  onStartResearch: (claims: string[]) => void
  onSubmitPlan: () => void
}) {
  const [feedbackOpen, setFeedbackOpen] = useState<string | null>(null)
  // Which section's regenerate is in flight, so its card shows the loader.
  const [regenKey, setRegenKey] = useState<string | null>(null)
  // The feedback box sits below the section text, which can be long enough to
  // push it off-screen — so opening it scrolls it into view and flashes a
  // highlight, making it obvious where to type.
  const feedbackBoxRef = useRef<HTMLDivElement>(null)
  const [highlighted, setHighlighted] = useState<string | null>(null)

  useEffect(() => {
    if (!feedbackOpen) return
    const box = feedbackBoxRef.current
    if (!box) return
    box.scrollIntoView({ behavior: 'smooth', block: 'center' })
    box.querySelector('textarea')?.focus({ preventScroll: true })
    setHighlighted(feedbackOpen)
    const t = setTimeout(() => setHighlighted(null), 1800)
    return () => clearTimeout(t)
  }, [feedbackOpen])
  const [feedback, setFeedback] = useState('')
  const [selectedGaps, setSelectedGaps] = useState<string[]>([])

  const gapLines = splitGapLines(analysis.gaps?.text)
  const allApproved = analysisAllApproved(analysis)

  function toggleGap(line: string) {
    setSelectedGaps((prev) => (prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line]))
  }

  return (
    <div className="mt-8 flex flex-col gap-5">
      {ANALYSIS_SECTION_ORDER.map((key) => {
        const section = analysis[key]
        if (!section) return null
        const label = ANALYSIS_SECTION_LABELS[key]
        const gated = key !== 'style_theme'
        const isGaps = key === 'gaps'

        return (
          <div key={key} className="bg-white border border-[#e5e3df] p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
                {gated && (
                  section.approved
                    ? <StatusPill label="Approved" tone="emerald" />
                    : <StatusPill label="Pending" tone="amber" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFeedbackOpen(feedbackOpen === key ? null : key)}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-black transition-colors"
                >
                  <RefreshCw size={13} />
                  Regenerate
                </button>
                {gated && !section.approved && (
                  <Button size="sm" variant="secondary" onClick={() => onApproveSection(key)} loading={busy === `approve_analysis_section_${key}`}>
                    Approve
                  </Button>
                )}
              </div>
            </div>

            {busy === 'regenerate_section' && regenKey === key && (
              <div className="mt-4">
                <CopywritingLoader variant="regenerate" compact />
              </div>
            )}
            <Markdown text={section.text} className="mt-3" />

            {feedbackOpen === key && (
              <div
                ref={feedbackBoxRef}
                className={`mt-4 flex flex-col gap-2 border-t border-[#e5e3df] pt-4 -mx-3 px-3 pb-3 rounded-lg transition-colors duration-700 ${highlighted === key ? 'bg-amber-50 ring-2 ring-amber-300' : 'bg-transparent ring-0'}`}
              >
                <Textarea label="Feedback for regeneration" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What should change?" />
                <Button
                  size="sm"
                  className="self-start"
                  loading={busy === 'regenerate_section'}
                  onClick={() => { setRegenKey(key); onRegenerate(key, feedback); setFeedback(''); setFeedbackOpen(null) }}
                >
                  Regenerate {label}
                </Button>
              </div>
            )}

            {isGaps && gapLines.length > 0 && (
              <div className="mt-4 border-t border-[#e5e3df] pt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Send to research</p>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedGaps.length === gapLines.length}
                      // Indeterminate when only some are ticked.
                      ref={(el) => { if (el) el.indeterminate = selectedGaps.length > 0 && selectedGaps.length < gapLines.length }}
                      onChange={() => setSelectedGaps(selectedGaps.length === gapLines.length ? [] : gapLines)}
                    />
                    Select all ({gapLines.length})
                  </label>
                </div>
                <div className="flex flex-col gap-1.5">
                  {gapLines.map((line) => (
                    <label key={line} className="flex items-start gap-2 text-xs text-gray-600">
                      <input type="checkbox" checked={selectedGaps.includes(line)} onChange={() => toggleGap(line)} className="mt-0.5" />
                      <span>{plainLine(line)}</span>
                    </label>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  disabled={selectedGaps.length === 0}
                  disabledReason="Tick at least one gap above to send it to research"
                  loading={busy === 'research'}
                  onClick={() => { onStartResearch(selectedGaps); setSelectedGaps([]) }}
                >
                  <Search size={13} className="mr-1.5 inline" /> Start Research ({selectedGaps.length || 0})
                </Button>
                {busy === 'research' && (
                  <div className="mt-3">
                    <CopywritingLoader variant="research" compact />
                  </div>
                )}
                {research.length > 0 && (
                  <p className="text-[10px] text-gray-400 mt-2">
                    {research.filter((r) => r.status === 'approved').length} of {research.length} research findings approved so far.
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}

      <ResearchRequestPanel busy={busy === 'research'} onResearch={onStartResearch} />

      <div className="flex justify-end">
        <Button onClick={onSubmitPlan} disabled={!allApproved} disabledReason="Approve every analysis section above before submitting for a plan" loading={busy === 'plan'} arrow>
          Submit &amp; Plan
        </Button>
      </div>
    </div>
  )
}

// ── Plan review ───────────────────────────────────────────────────────
function PlanStage({
  planOutput,
  planStatus,
  busy,
  onApprove,
  onRequestChanges,
  onDraft,
}: {
  planOutput: string
  planStatus: string
  busy: string | null
  onApprove: () => void
  onRequestChanges: (feedback: string) => Promise<unknown>
  onDraft: () => void
}) {
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const replanning = busy === 'replan'

  // Keep the box open (with the writer's text) until the revised plan
  // arrives, so the in-progress state stays visible; close only on success.
  async function sendChanges() {
    const ok = await onRequestChanges(feedback)
    if (ok) {
      setFeedback('')
      setShowFeedback(false)
    }
  }

  return (
    <div className="mt-8 bg-white border border-[#e5e3df] p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Article plan</h2>
        {planStatus === 'approved' && <StatusPill label="Approved" tone="emerald" />}
      </div>
      {replanning && (
        <div className="mt-3">
          <CopywritingLoader variant="replan" compact />
        </div>
      )}
      <div className={`transition-opacity ${replanning ? 'opacity-40' : ''}`}>
        <Markdown text={planOutput} className="mt-3" />
      </div>

      {planStatus !== 'approved' && (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#e5e3df] pt-5">
          <Button size="sm" onClick={onApprove} loading={busy === 'approve_plan_undefined' || busy === 'approve_plan_'} disabled={replanning} disabledReason="Wait for the revised plan before approving">
            <CheckCircle2 size={14} className="mr-1.5 inline" /> Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowFeedback((s) => !s)} disabled={replanning} disabledReason="The plan is already being revised">
            Request Changes
          </Button>
        </div>
      )}

      {showFeedback && (
        <div className="mt-4 flex flex-col gap-2">
          <Textarea label="What should change?" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={replanning} />
          <Button size="sm" className="self-start" loading={replanning} onClick={sendChanges}>
            Send
          </Button>
        </div>
      )}

      {planStatus === 'approved' && (
        <div className="mt-6 border-t border-[#e5e3df] pt-5 flex justify-end">
          <Button onClick={onDraft} loading={busy === 'draft'} arrow>
            Draft
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Draft, checks & revision chat ────────────────────────────────────
function DraftStage({
  project,
  images,
  onImagesChange,
  messages,
  busy,
  isAdmin,
  onRunCheck,
  onRevised,
  onError,
  onApproveFinal,
  onStartResearch,
  flaggedGaps,
  unusedApproved,
  applySignal,
  onOpenLedger,
  onAiResult,
}: {
  project: CopywritingProject
  images: CopywritingProjectImage[]
  onImagesChange: (images: CopywritingProjectImage[]) => void
  messages: CopywritingMessage[]
  busy: string | null
  isAdmin: boolean
  onRunCheck: () => void
  onRevised: () => Promise<void>
  onError: (message: string | null) => void
  onApproveFinal: () => void
  onStartResearch: (claims: string[]) => void
  flaggedGaps: string[]
  unusedApproved: CopywritingResearchEntry[]
  applySignal: number
  onOpenLedger: () => void
  onAiResult: () => void
}) {
  const [chatInput, setChatInput] = useState('')
  // Image slots: configured count (null = the AI decided) vs. slots actually
  // in the draft vs. slots with a photo.
  const configuredImages = project.image_count
  const maxSlot = maxUploadableSlot(configuredImages)
  const draftSlotNumbers = Array.from(new Set(
    splitArticleImages(project.draft_text || '').flatMap((seg) => (seg.type === 'image' && seg.slot <= maxSlot ? [seg.slot] : [])),
  ))
  const draftSlots = draftSlotNumbers.length
  const filledSlots = images.filter((img) => draftSlotNumbers.includes(img.slot)).length
  // What the "x of y added" pill counts against: the set number, or — when
  // the AI chose — however many slots it put in the draft.
  const imageCount = configuredImages ?? draftSlots
  const checks = project.checks?.items || CHECK_ITEM_LABELS.map((label) => ({ label, result: 'warning' as const, detail: 'Not run yet' }))

  // The in-flight turn: the writer's question (shown immediately) and the
  // reply as it streams in. Cleared once the saved messages are reloaded.
  const [pending, setPending] = useState<{ question: string; reply: string } | null>(null)
  const sending = pending !== null
  const chatScroll = useStickToBottom<HTMLDivElement>(`${messages.length}:${pending?.question ?? ''}:${pending?.reply.length ?? 0}`)

  // ONE request per message. The revision action streams SSE: {delta}
  // chunks, then {done, …} or {error}. (This used to POST here AND call the
  // parent's runAction('revision'), so every question ran twice.)
  // `override` sends a prepared message (e.g. "update the draft with the
  // approved research") without touching what's typed in the input box.
  async function send(override?: string) {
    const message = (override ?? chatInput).trim()
    if (!message || sending) return
    if (override === undefined) setChatInput('')
    onError(null)
    setPending({ question: message, reply: '' })

    let failure: string | null = null
    let revised = false

    // Runs once, when the revised draft is saved (`done`) or the stream ends.
    let finished = false
    const finish = async () => {
      if (finished) return
      finished = true
      await onRevised()
      setPending(null)
      // Every refine rewrites the draft, so re-run the automated checks against
      // the new version — same as Draft does right after writing it.
      if (revised && !failure) {
        onRunCheck()
        onAiResult()
      }
      if (failure) {
        onError(failure)
        if (override === undefined) setChatInput(message)
      }
    }

    try {
      const res = await fetch(`/api/copywriting/${project.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revision', message }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        failure = data.error || 'Something went wrong'
      } else {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() || ''
          for (const evt of events) {
            const line = evt.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            const data = JSON.parse(line.slice(6))
            if (data.delta) setPending((p) => (p ? { ...p, reply: p.reply + data.delta } : p))
            if (data.error) failure = data.error
            if (data.done) {
              revised = true
              await finish()
            }
          }
        }
      }
    } catch {
      // Dropped connection — the server may still have finished and saved
      // the reply, so reload rather than assume it failed.
    }

    await finish()
  }

  function applyApprovedResearch() {
    if (unusedApproved.length) send(applyResearchMessage(unusedApproved))
  }

  // The Research Ledger's "Update draft" button bumps applySignal.
  const lastApplySignal = useRef(applySignal)
  useEffect(() => {
    if (applySignal === lastApplySignal.current) return
    lastApplySignal.current = applySignal
    applyApprovedResearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per signal
  }, [applySignal])

  return (
    <div className="mt-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 flex flex-col gap-6">
        <div className="bg-white border border-[#e5e3df] p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-900">Draft</h2>
            {imageCount > 0 && (
              <StatusPill
                label={`${filledSlots} of ${imageCount} image${imageCount === 1 ? '' : 's'} added`}
                tone={filledSlots >= imageCount ? 'emerald' : 'amber'}
              />
            )}
          </div>
          {configuredImages !== null && configuredImages > 0 && draftSlots < configuredImages && (
            <p className="mt-2 text-xs text-amber-700">
              The draft has {draftSlots} of {imageCount} image slots — ask the refine chat to add the missing {imageCount - draftSlots === 1 ? 'one' : 'ones'}.
            </p>
          )}
          <ArticleWithImages
            projectId={project.id}
            ownerId={project.user_id}
            markdown={project.draft_text || ''}
            images={images}
            imageCount={project.image_count}
            editable
            onImagesChange={onImagesChange}
            className="mt-3 max-h-[32rem] overflow-y-auto"
          />
        </div>

        <div className="bg-white border border-[#e5e3df] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Automated checks</h3>
            <Button size="sm" variant="secondary" onClick={onRunCheck} loading={busy === 'check'}>
              <RefreshCw size={13} className="mr-1.5 inline" /> Run Check Again
            </Button>
          </div>
          {busy === 'check' ? (
            <div className="mt-3">
              <CopywritingLoader variant="check" compact />
            </div>
          ) : (
            project.checks_run_at && <p className="text-[10px] text-gray-400 mt-1">Last run {new Date(project.checks_run_at).toLocaleString()}</p>
          )}
          <div className={`mt-4 flex flex-col gap-2 transition-opacity ${busy === 'check' ? 'opacity-40' : ''}`}>
            {checks.map((c, i) => (
              <div key={i} className="flex items-start justify-between gap-4 text-sm">
                <div className="min-w-0">
                  <p className="text-gray-800">{plainLine(c.label)}</p>
                  <p className="text-xs text-gray-400">{plainLine(c.detail)}</p>
                </div>
                <div className="flex-shrink-0">
                  <StatusPill
                    label={c.result}
                    tone={c.result === 'pass' ? 'emerald' : c.result === 'fail' ? 'red' : 'amber'}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Approved research the draft doesn't use yet → one click works it
            in via the refine chat (same streamed revision as a typed message). */}
        {unusedApproved.length > 0 && (
          <div className="border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-xs font-semibold text-emerald-900">
              {unusedApproved.length} approved finding{unusedApproved.length === 1 ? '' : 's'} not in the draft yet
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {unusedApproved.map((r) => (
                <p key={r.id} className="text-xs text-emerald-800">• {r.claim}</p>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={applyApprovedResearch}
                disabled={sending}
                disabledReason="Wait for the current revision to finish"
              >
                Update draft with approved research
              </Button>
              <button onClick={onOpenLedger} className="text-xs text-gray-500 hover:text-black">Review in Research Ledger</button>
            </div>
          </div>
        )}

        {/* Nothing is researched automatically: Claude only flags missing facts;
            the writer chooses what to send to Gemini. */}
        <ResearchRequestPanel flaggedGaps={flaggedGaps} busy={busy === 'research'} onResearch={onStartResearch} />

        <div className="flex justify-end">
          <Button onClick={onApproveFinal} loading={busy === 'approve_final'} arrow>
            Approve Final Version
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2 flex flex-col bg-white border border-[#e5e3df] h-[38rem]">
        <div className="px-5 py-4 border-b border-[#e5e3df]">
          <p className="text-sm font-semibold text-gray-900">Refine with Claude</p>
          <p className="text-xs text-gray-400 mt-0.5">Ask for cuts, restructuring, a tone change, or a fact re-check.</p>
        </div>
        <div ref={chatScroll.ref} onScroll={chatScroll.onScroll} onWheel={chatScroll.onWheel} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {messages.length === 0 && !pending && <p className="text-xs text-gray-400">No messages yet — start the conversation below.</p>}
          {messages.map((m) => (
            m.role === 'user' ? (
              <div key={m.id} className="text-sm max-w-[90%] px-3.5 py-2.5 rounded-lg whitespace-pre-wrap self-end bg-black text-white">
                {m.content}
              </div>
            ) : (
              <div key={m.id} className="max-w-[90%] px-3.5 py-2.5 rounded-lg self-start bg-gray-100">
                <Markdown text={m.content} className="text-gray-800" />
              </div>
            )
          ))}
          {pending && (
            <>
              <div className="text-sm max-w-[90%] px-3.5 py-2.5 rounded-lg whitespace-pre-wrap self-end bg-black text-white">
                {pending.question}
              </div>
              {pending.reply ? (
                <div className="max-w-[90%] px-3.5 py-2.5 rounded-lg self-start bg-gray-100">
                  <Markdown text={pending.reply} className="text-gray-800" />
                </div>
              ) : (
                <div className="w-full max-w-[90%] self-start">
                  <CopywritingLoader variant="revise" compact />
                </div>
              )}
            </>
          )}
        </div>
        <div className="p-4 border-t border-[#e5e3df] flex items-center gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            disabled={sending}
            placeholder="e.g. Tighten the second paragraph"
            className="flex-1 border border-[#e5e3df] rounded-full px-4 py-2.5 text-sm focus:outline-none focus:border-black"
          />
          <span title={sending ? 'Waiting for the reply to your last message' : undefined} className={`flex-shrink-0 ${sending ? 'cursor-not-allowed' : ''}`}>
            <button onClick={() => send()} disabled={sending} className="bg-black text-white rounded-full p-2.5 disabled:opacity-40 disabled:pointer-events-none">
              <Send size={15} />
            </button>
          </span>
        </div>
      </div>
      {isAdmin && null}
    </div>
  )
}

// ── Completed project: final output + full history ──────────────────────
function CompletedView({
  project,
  images,
  onImagesChange,
  events,
  onOpenLedger,
  ledgerOpen,
  setLedgerOpen,
  researchAll,
}: {
  project: CopywritingProject
  events: CopywritingProjectEvent[]
  research: CopywritingResearchEntry[]
  onOpenLedger: () => void
  ledgerOpen: boolean
  setLedgerOpen: (v: boolean) => void
  researchAll: CopywritingResearchEntry[]
  images: CopywritingProjectImage[]
  onImagesChange: (images: CopywritingProjectImage[]) => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyText() {
    if (!project.final_output) return
    await copyArticle(project.final_output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <StatusPill label="Complete" tone="emerald" />
        <div className="flex items-center gap-2">
          <button onClick={onOpenLedger} className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase text-gray-500 hover:text-black transition-colors">
            <BookOpen size={14} />
            Research Ledger
          </button>
        </div>
      </div>

      <div className="mt-6 bg-white border border-[#e5e3df] p-6 sm:p-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-gray-900">Final article</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={copyText}>
              <Copy size={13} className="mr-1.5 inline" /> {copied ? 'Copied' : 'Copy'}
            </Button>
            <a href={`/api/copywriting/${project.id}/export?format=docx`}>
              <Button size="sm" variant="secondary"><Download size={13} className="mr-1.5 inline" /> Word</Button>
            </a>
            <a href={`/api/copywriting/${project.id}/export?format=pdf`}>
              <Button size="sm" variant="secondary"><Download size={13} className="mr-1.5 inline" /> PDF</Button>
            </a>
          </div>
        </div>
        <ArticleWithImages
          projectId={project.id}
          ownerId={project.user_id}
          markdown={project.final_output || ''}
          images={images}
          imageCount={project.image_count}
          editable
          onImagesChange={onImagesChange}
          className="mt-4"
        />
      </div>

      <div className="mt-8 bg-white border border-[#e5e3df] p-6 sm:p-8">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <ArrowLeft size={0} className="hidden" />
          Full history
        </h2>
        <div className="mt-4 flex flex-col gap-4">
          {events.map((e) => (
            <div key={e.id} className="flex gap-3 text-sm">
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5" />
              <div className="min-w-0">
                <p className="text-gray-700">{e.summary}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{new Date(e.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ResearchLedgerModal open={ledgerOpen} onClose={() => setLedgerOpen(false)} entries={researchAll} onChanged={async () => {}} projectId={project.id} readOnly />
    </div>
  )
}
