'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles, Copy, Check, Download, UserPlus, RotateCcw, AlertTriangle,
  ChevronDown, ChevronUp, Mail, Globe2, Newspaper, Loader2, AlertCircle, FileText, Anchor, Search, Pencil,
} from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import ParagraphCard from '@/components/interview-letters/ParagraphCard'
import PersonalizeModal from '@/components/interview-letters/PersonalizeModal'
import InterviewLetterLoader from '@/components/interview-letters/InterviewLetterLoader'
import DownloadTemplateModal from '@/components/ui/DownloadTemplateModal'
import { useStickToBottom } from '@/lib/use-stick-to-bottom'
import { formatDayMonthYear } from '@/lib/date-format'
import { letterDownloadName, wordCount, splitEmailSubject, splitMarkdownLinks, variantLabel } from '@/lib/interview-letters'
import { guessTemplateId } from '@/lib/download-templates/registry'
import type { InterviewLetterProject, InterviewLetterPersonalization, InterviewLetterStage } from '@/types'

interface Props {
  project: InterviewLetterProject
  isGenerating: boolean
  isAdmin: boolean
}

type StepState = 'done' | 'active' | 'error' | 'upcoming'

// The four steps in the header. Any step that has content can be opened to
// look at it; reopening it for changes is a separate, explicit action.
type StepKey = 'research' | 'letter' | 'email' | 'send'
const STEP_KEYS: StepKey[] = ['research', 'letter', 'email', 'send']

function stepForStage(stage: InterviewLetterStage): StepKey {
  if (stage === 'letter_generating' || stage === 'letter_review' || stage === 'letter_approved') return 'letter'
  if (stage === 'email_generating' || stage === 'email_review') return 'email'
  if (stage === 'complete') return 'send'
  return 'research'
}

const STALL_THRESHOLD = 40 // ~2 min of 3s polls

async function readSSE(res: Response, onEvent: (data: unknown) => void) {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const dataLine = line.split('\n').find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      const data = dataLine.slice(6)
      if (data === '[DONE]') return
      try {
        onEvent(JSON.parse(data))
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-black"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// Pulling the subject into its own row keeps it from being buried in the body.
function EmailPreview({ text }: { text: string }) {
  const { subject, body } = splitEmailSubject(text)
  return (
    <div className="overflow-hidden rounded-xl border border-[#e5e3df]">
      {subject && (
        <div className="flex items-baseline gap-2 border-b border-[#e5e3df] bg-[#faf9f7] px-4 py-3 sm:px-5">
          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Subject</span>
          <span className="text-sm font-medium text-gray-900">{subject}</span>
        </div>
      )}
      <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-gray-800 sm:px-5">{body}</div>
    </div>
  )
}

function Card({ children, tone = 'default', className = '' }: { children: React.ReactNode; tone?: 'default' | 'emerald'; className?: string }) {
  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-sm sm:p-6 ${
        tone === 'emerald' ? 'border-emerald-200' : 'border-[#e5e3df]'
      } ${className}`}
    >
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">{children}</p>
}

// Research lines carry their sources as inline markdown links; render them
// as real links (each one opens the page the fact came from).
function ResearchLine({ text }: { text: string }) {
  return (
    <p className="text-sm leading-relaxed text-gray-700">
      •{' '}
      {splitMarkdownLinks(text).map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.value}</span>
        ) : (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-0.5 inline-block rounded bg-[#f0efec] px-1.5 py-0.5 align-baseline text-[11px] font-medium text-gray-600 no-underline transition-colors hover:bg-[#e5e3df] hover:text-black"
          >
            {part.label}
          </a>
        ),
      )}
    </p>
  )
}

// Primary rounded action button, matching the pattern used across the other
// multi-stage AI workflows (Sales Coach, Meeting Prep) rather than the
// shared form <Button> (which is meant for uppercase form submits).
function PrimaryButton({
  onClick, loading, disabled, children, icon,
}: {
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

function DownloadLetterButton({ onClick, label = 'Download Letter' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-400 hover:shadow-md"
    >
      <Download size={14} /> {label}
    </button>
  )
}

const STAGE_META: Record<string, { label: string; tone: string }> = {
  input: { label: 'Starting…', tone: 'bg-[#fbf7ed] text-[#a07530]' },
  researching: { label: 'Researching', tone: 'bg-[#fbf7ed] text-[#a07530]' },
  hook_review: { label: 'Hook review', tone: 'bg-sky-50 text-sky-700' },
  letter_generating: { label: 'Generating letter', tone: 'bg-[#fbf7ed] text-[#a07530]' },
  letter_review: { label: 'Letter review', tone: 'bg-sky-50 text-sky-700' },
  letter_approved: { label: 'Letter approved', tone: 'bg-emerald-50 text-emerald-700' },
  email_generating: { label: 'Generating email', tone: 'bg-[#fbf7ed] text-[#a07530]' },
  email_review: { label: 'Email review', tone: 'bg-sky-50 text-sky-700' },
  complete: { label: 'Complete', tone: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'Needs attention', tone: 'bg-red-50 text-red-700' },
}

function Stepper({
  steps, selected, onSelect,
}: {
  steps: { label: string; sub: string; state: StepState; clickable: boolean }[]
  selected: number
  onSelect: (index: number) => void
}) {
  return (
    <ol className="grid grid-cols-2 gap-2 border-t border-[#eceae5] px-4 py-3 sm:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.label} className="min-w-0">
          <button
            type="button"
            onClick={() => onSelect(i)}
            disabled={!s.clickable}
            aria-current={i === selected ? 'step' : undefined}
            title={s.clickable ? `View ${s.label}` : undefined}
            className={`flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors ${
              i === selected ? 'bg-[#f7f6f3]' : s.clickable ? 'hover:bg-[#faf9f7]' : 'cursor-default'
            }`}
          >
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
          </button>
        </li>
      ))}
    </ol>
  )
}

// Research, updates since the brief and cautions — shown on the hook screen
// and when looking back at the research step.
function ResearchCards({ project }: { project: InterviewLetterProject }) {
  return (
    <>
      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Research</p>
          {project.research_provider && (
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
              <Search size={11} />
              {project.research_provider === 'gemini' ? 'Checked with Gemini + Google Search' : 'Checked with Claude web search'}
              {project.editorial_brief_title ? ` against ${project.editorial_brief_title}` : ''}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          {project.research.length === 0 ? (
            <p className="text-sm text-gray-400">No research bullets came back.</p>
          ) : (
            project.research.map((bullet, i) => <ResearchLine key={i} text={bullet} />)
          )}
        </div>
      </Card>

      {project.editorial_brief_title && (project.research_updates || []).length > 0 && (
        <Card>
          <SectionLabel>Updates since the Editorial Brief</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {project.research_updates.map((line, i) => <ResearchLine key={i} text={line} />)}
          </div>
        </Card>
      )}

      {(project.research_cautions || []).length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm sm:p-6">
          <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">
            <AlertTriangle size={12} /> Cautions
          </p>
          <div className="flex flex-col gap-2.5">
            {project.research_cautions.map((line, i) => <ResearchLine key={i} text={line} />)}
          </div>
        </div>
      )}
    </>
  )
}

// The approved letter with its Copy and Download actions.
function ApprovedLetterCard({ text, onDownload }: { text: string; onDownload: () => void }) {
  return (
    <Card tone="emerald">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Approved Letter</SectionLabel>
        <div className="-mt-3 flex items-center gap-2">
          <CopyButton text={text} />
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-black"
          >
            <Download size={13} /> Download
          </button>
        </div>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{text}</div>
    </Card>
  )
}

// Secondary action button used in the step views.
function SecondaryButton({ onClick, disabled, children, icon }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-400 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
    >
      {icon}
      {children}
    </button>
  )
}

export default function InterviewLetterWorkspace({ project: initialProject, isGenerating }: Props) {
  const [project, setProject] = useState(initialProject)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)
  const [busy, setBusy] = useState(false)
  // The editor's "additional context" (hook_input) is research input, not a
  // hook, so it never pre-fills the box.
  const [hook, setHook] = useState(project.confirmed_hook || project.hook_ai_suggestion || '')
  const [emailFeedback, setEmailFeedback] = useState('')
  const [personalizeOpen, setPersonalizeOpen] = useState(false)
  // Which letter the download dialog is for: the master (null personalization)
  // or one recipient's personalized letter.
  const [download, setDownload] = useState<{ personalization: InterviewLetterPersonalization | null } | null>(null)
  const [personalizations, setPersonalizations] = useState<InterviewLetterPersonalization[]>([])
  const [expandedPersonalizationId, setExpandedPersonalizationId] = useState<string | null>(null)
  const [personalizationView, setPersonalizationView] = useState<'email' | 'letter'>('email')
  // A step opened from the header to look at; null follows the project's
  // current step.
  const [viewStep, setViewStep] = useState<StepKey | null>(null)
  const pollCountRef = useRef(0)
  const startedRef = useRef(false)

  const scrollProps = useStickToBottom<HTMLDivElement>(`${project.stage}:${project.research.length}:${statusText}`)

  // Live elapsed-time counter for the loader, ticking for as long as a
  // blank-slate AI wait is in flight — reset the moment a new one starts.
  const [elapsedSecs, setElapsedSecs] = useState(0)
  useEffect(() => {
    if (!busy) return
    const startedAt = Date.now()
    setElapsedSecs(0)
    const ticker = setInterval(() => setElapsedSecs(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(ticker)
  }, [busy])

  // `rerun` refreshes the research from a later step; the letter and email
  // stay, and a failed re-run leaves the project on the step it was on.
  const startResearch = useCallback(async (rerun = false) => {
    setBusy(true)
    setRunError(null)
    setStalled(false)
    setStatusText('Researching…')
    setViewStep(null)
    if (rerun) setProject((p) => ({ ...p, stage: 'researching' }))
    let finished = false
    try {
      const res = await fetch(`/api/interview-letters/${project.id}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rerun }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRunError(data.error || 'Research failed')
        setBusy(false)
        if (rerun) await refreshProject()
        return
      }
      await readSSE(res, (data) => {
        const d = data as {
          status?: string; error?: string; done?: boolean; provider?: 'gemini' | 'claude'
          research?: string[]; researchUpdates?: string[]; researchCautions?: string[]; hookAiSuggestion?: string
        }
        if (d.status === 'web_search_start') setStatusText('Checking the latest sources…')
        else if (d.status === 'researching') setStatusText(project.editorial_brief_title ? 'Reading the Editorial Brief…' : 'Researching…')
        else if (d.status === 'refining') setStatusText('Refining…')
        else if (d.status === 'synthesising') setStatusText(project.editorial_brief_title ? 'Comparing with the Editorial Brief…' : 'Summarising the research…')
        else if (d.error) setRunError(d.error)
        else if (d.done) {
          setProject((p) => ({
            ...p,
            stage: 'hook_review',
            research: d.research || [],
            research_updates: d.researchUpdates || [],
            research_cautions: d.researchCautions || [],
            research_provider: d.provider || p.research_provider,
            hook_ai_suggestion: d.hookAiSuggestion || null,
          }))
          setHook(rerun ? d.hookAiSuggestion || '' : (prev) => prev || d.hookAiSuggestion || '')
          finished = true
        }
      })
    } catch {
      setRunError('Network error during research. Please try again.')
    } finally {
      setBusy(false)
      setStatusText(null)
      if (rerun && !finished) await refreshProject()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.editorial_brief_title])

  // Re-reads the project (e.g. after a failed re-run put it back on its step).
  async function refreshProject() {
    const res = await fetch(`/api/interview-letters/${project.id}`)
    if (res.ok) setProject(await res.json())
  }

  async function reopenStep(step: 'hook' | 'letter' | 'email') {
    setBusy(true)
    setRunError(null)
    const res = await fetch(`/api/interview-letters/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reopen: step }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setRunError(data.error || 'Could not reopen that step.')
      return
    }
    setProject((p) => ({ ...p, stage: data.stage }))
    setViewStep(null)
  }

  function handleRerunResearch() {
    if (!window.confirm('Run the research again? It replaces the current research and costs a little more. Your letter and email are kept.')) return
    startResearch(true)
  }

  // Auto-start research once, right after project creation.
  useEffect(() => {
    if (startedRef.current) return
    if (isGenerating && project.stage === 'input') {
      startedRef.current = true
      startResearch()
    }
  }, [isGenerating, project.stage, startResearch])

  // Reconnect-by-polling if we land on a project mid-research from another
  // tab/session (no isGenerating flag, but stage is still in-flight).
  useEffect(() => {
    if (project.stage !== 'researching') return
    const interval = setInterval(async () => {
      pollCountRef.current += 1
      if (pollCountRef.current > STALL_THRESHOLD) {
        setStalled(true)
        return
      }
      const res = await fetch(`/api/interview-letters/${project.id}`)
      if (!res.ok) return
      const data = await res.json()
      if (data.stage !== 'researching') {
        setProject(data)
        pollCountRef.current = 0
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [project.stage, project.id])

  async function handleRetryStalled() {
    setStalled(false)
    pollCountRef.current = 0
    await fetch(`/api/interview-letters/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetStalledStage: true }),
    })
    setProject((p) => ({ ...p, stage: 'input' }))
    startedRef.current = true
    startResearch()
  }

  async function handleConfirmHook() {
    if (!hook.trim()) return
    setBusy(true)
    setRunError(null)
    // If what's being confirmed exactly matches the AI's proposal, credit it
    // as 'ai'; any edit or original user-authored hook counts as 'user'.
    const hookSource = hook.trim() === (project.hook_ai_suggestion || '').trim() ? 'ai' : 'user'
    const res = await fetch(`/api/interview-letters/${project.id}/letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook, hookSource }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setRunError(data.error || 'Failed to generate the letter.')
      return
    }
    setProject((p) => ({
      ...p,
      stage: 'letter_review',
      paragraphs: data.paragraphs,
      samples_used: data.samplesUsed || [],
      confirmed_hook: hook,
      hook_source: hookSource,
    }))
  }

  async function handleApproveParagraph(key: string) {
    const res = await fetch(`/api/interview-letters/${project.id}/letter/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) setProject((p) => ({ ...p, paragraphs: data.paragraphs }))
  }

  async function handleUnlockParagraph(key: string) {
    const res = await fetch(`/api/interview-letters/${project.id}/letter/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) setProject((p) => ({ ...p, paragraphs: data.paragraphs }))
    else setRunError(data.error || 'Could not unlock this paragraph.')
  }

  async function handleRegenerateParagraph(key: string, feedback: string) {
    const res = await fetch(`/api/interview-letters/${project.id}/letter/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, feedback }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setProject((p) => ({
        ...p,
        paragraphs: p.paragraphs.map((par) => (par.key === key ? { ...par, content: data.text, lastFeedback: feedback } : par)),
      }))
    } else {
      setRunError(data.error || 'Failed to regenerate this paragraph.')
    }
  }

  async function handleFinalApprove() {
    setBusy(true)
    setRunError(null)
    const res = await fetch(`/api/interview-letters/${project.id}/letter/final-approve`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setRunError(data.error || 'Failed to finalize the letter.')
      return
    }
    setProject((p) => ({ ...p, stage: 'letter_approved', master_letter: data.masterLetter }))
  }

  async function handleGenerateEmail() {
    setBusy(true)
    setRunError(null)
    const res = await fetch(`/api/interview-letters/${project.id}/email`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setRunError(data.error || 'Failed to generate the email.')
      return
    }
    setProject((p) => ({ ...p, stage: 'email_review', master_email: data.email }))
  }

  async function handleRegenerateEmail() {
    setBusy(true)
    setRunError(null)
    const res = await fetch(`/api/interview-letters/${project.id}/email/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: emailFeedback }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setRunError(data.error || 'Failed to regenerate the email.')
      return
    }
    setProject((p) => ({ ...p, master_email: data.email }))
    setEmailFeedback('')
  }

  async function handleApproveEmail() {
    setBusy(true)
    setRunError(null)
    const res = await fetch(`/api/interview-letters/${project.id}/email/approve`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setRunError(data.error || 'Failed to approve the email.')
      return
    }
    setProject((p) => ({ ...p, stage: 'complete' }))
  }

  useEffect(() => {
    if (project.stage !== 'complete') return
    fetch(`/api/interview-letters/${project.id}/personalizations`)
      .then((r) => r.json())
      .then((d) => setPersonalizations(d.personalizations || []))
      .catch(() => {})
  }, [project.stage, project.id])

  const totalLetterWords = wordCount((project.paragraphs || []).map((p) => p.content).join('\n\n'))
  const unlockedCount = (project.paragraphs || []).filter((p) => p.type === 'variable' && p.status !== 'locked').length

  const researchStep: StepState =
    project.stage === 'failed' && project.research.length === 0 ? 'error'
    : project.stage === 'input' || project.stage === 'researching' ? 'active'
    : 'done'
  const letterStep: StepState =
    project.stage === 'hook_review' || project.stage === 'letter_review' ? 'active'
    : project.stage === 'failed' && project.research.length > 0 && !project.master_letter ? 'error'
    : project.stage === 'letter_approved' || project.stage === 'email_review' || project.stage === 'complete' ? 'done'
    : 'upcoming'
  const emailStep: StepState =
    (project.stage === 'letter_approved' && busy) || project.stage === 'email_review' ? 'active'
    : project.stage === 'complete' ? 'done'
    : 'upcoming'
  const doneStep: StepState = project.stage === 'complete' ? 'done' : 'upcoming'

  const currentStep = stepForStage(project.stage)
  // Steps there is something to look at (never while an AI call is running).
  const hasContent: Record<StepKey, boolean> = {
    research: project.research.length > 0,
    letter: Boolean(project.master_letter) || (project.paragraphs || []).length > 0,
    email: Boolean(project.master_email),
    send: project.stage === 'complete',
  }
  const reviewing = viewStep && viewStep !== currentStep ? viewStep : null
  const shownStep = reviewing || currentStep

  const steps = [
    { label: 'Research & Hook', sub: project.stage === 'researching' || project.stage === 'input' ? (statusText || 'Working…') : 'Why-now hook', state: researchStep },
    { label: 'Letter', sub: project.stage === 'letter_review' ? `${totalLetterWords} words` : 'Paragraph by paragraph', state: letterStep },
    { label: 'Email', sub: 'General cover email', state: emailStep },
    { label: 'Send', sub: 'Export & personalize', state: doneStep },
  ].map((step, i) => ({ ...step, clickable: !busy && (STEP_KEYS[i] === currentStep || hasContent[STEP_KEYS[i]]) }))

  const stageMeta = STAGE_META[project.stage] || { label: project.stage, tone: 'bg-gray-100 text-gray-600' }

  return (
    <div ref={scrollProps.ref} onScroll={scrollProps.onScroll} onWheel={scrollProps.onWheel} className="h-full overflow-y-auto p-6 sm:p-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex-shrink-0 rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700">
                <Mail size={18} />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-gray-900">{project.company} — {project.media_partner}</h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1.5"><Globe2 size={12} />{project.project_country}</span>
                  {project.media_partner_country && (
                    <span className="inline-flex items-center gap-1.5"><Newspaper size={12} />{project.media_partner_country}</span>
                  )}
                  <span className="inline-flex items-center gap-1.5"><Anchor size={12} />{variantLabel(project.letter_variant)}</span>
                  {project.editorial_brief_title && (
                    <span className="inline-flex items-center gap-1.5"><FileText size={12} />{project.editorial_brief_title}</span>
                  )}
                </div>
              </div>
            </div>
            <span className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${stageMeta.tone}`}>
              {stageMeta.label}
            </span>
          </div>
          <Stepper
            steps={steps}
            selected={STEP_KEYS.indexOf(shownStep)}
            onSelect={(i) => setViewStep(STEP_KEYS[i] === currentStep ? null : STEP_KEYS[i])}
          />
        </div>

        {runError && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{runError}</span>
          </div>
        )}

        {stalled && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 shadow-sm">
            <span>This step seems to have stalled.</span>
            <button
              type="button"
              onClick={handleRetryStalled}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-amber-800"
            >
              <RotateCcw size={12} /> Retry
            </button>
          </div>
        )}

        {reviewing && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 shadow-sm">
              <span>You’re looking back at an earlier step. Nothing changes unless you reopen it.</span>
              <button
                type="button"
                onClick={() => setViewStep(null)}
                className="text-xs font-medium underline underline-offset-2 hover:text-black"
              >
                Back to current step
              </button>
            </div>

            {reviewing === 'research' && (
              <>
                <ResearchCards project={project} />
                {project.confirmed_hook && (
                  <Card>
                    <SectionLabel>{project.letter_variant === 'anchor' ? 'Confirmed anchor & hook' : 'Confirmed purpose & hook'}</SectionLabel>
                    <p className="text-sm leading-relaxed text-gray-800">{project.confirmed_hook}</p>
                  </Card>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <PrimaryButton onClick={() => reopenStep('hook')} loading={busy} icon={<Pencil size={15} />}>
                    Edit hook &amp; redraft letter
                  </PrimaryButton>
                  <SecondaryButton onClick={handleRerunResearch} disabled={busy} icon={<RotateCcw size={14} />}>
                    Run research again
                  </SecondaryButton>
                </div>
              </>
            )}

            {reviewing === 'letter' && (
              <>
                {project.master_letter ? (
                  <ApprovedLetterCard text={project.master_letter} onDownload={() => setDownload({ personalization: null })} />
                ) : (
                  <Card>
                    <SectionLabel>Letter draft</SectionLabel>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                      {(project.paragraphs || []).map((p) => p.content).join('\n\n')}
                    </div>
                  </Card>
                )}
                <div>
                  <PrimaryButton onClick={() => reopenStep('letter')} loading={busy} icon={<Pencil size={15} />}>
                    {currentStep === 'research' ? 'Keep this letter' : 'Edit letter'}
                  </PrimaryButton>
                </div>
              </>
            )}

            {reviewing === 'email' && (
              <>
                <Card>
                  <div className="mb-3 flex items-center justify-between">
                    <SectionLabel>{project.stage === 'complete' ? 'Approved General Email' : 'General Email'}</SectionLabel>
                    <CopyButton text={project.master_email || ''} />
                  </div>
                  <EmailPreview text={project.master_email || ''} />
                </Card>
                {(project.stage === 'complete' || project.stage === 'letter_approved') && (
                  <div>
                    <PrimaryButton onClick={() => reopenStep('email')} loading={busy} icon={<Pencil size={15} />}>
                      {project.stage === 'letter_approved' ? 'Keep this email' : 'Edit email'}
                    </PrimaryButton>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!reviewing && (
          <>
          {(project.stage === 'input' || project.stage === 'researching') && !stalled && (
            <InterviewLetterLoader label={statusText || 'Starting research…'} elapsedSecs={elapsedSecs} variant="research" />
          )}

          {project.stage === 'failed' && (
            <div className="flex flex-col items-start gap-4 rounded-2xl border border-[#e5e3df] bg-white p-8 shadow-sm">
              <div className="rounded-full bg-red-50 p-3 text-red-600">
                <AlertCircle size={20} />
              </div>
              <p className="text-sm text-gray-600">{project.error || 'Something went wrong.'}</p>
              <PrimaryButton onClick={() => startResearch()} loading={busy} icon={<RotateCcw size={15} />}>
                Retry Research
              </PrimaryButton>
            </div>
          )}

          {project.stage === 'hook_review' && busy && (
            <InterviewLetterLoader label="Generating the letter…" elapsedSecs={elapsedSecs} variant="letter" />
          )}

          {project.stage === 'hook_review' && !busy && (
            <div className="flex flex-col gap-5">
              <ResearchCards project={project} />

              <Card>
                <Textarea
                  label={project.letter_variant === 'anchor' ? 'Anchor & Why-Now Hook' : 'Report Purpose & Why-Now Hook'}
                  value={hook}
                  onChange={(e) => setHook(e.target.value)}
                  rows={3}
                />
                <p className="mt-1.5 text-xs text-gray-400">
                  {project.letter_variant === 'anchor'
                    ? `Built on your anchor${project.anchor ? ` (${project.anchor})` : ''}: how it connects to the report. Edit, replace, or accept it.`
                    : 'The report’s purpose and why it is timely now, proposed from the research above. Edit, replace, or accept it.'}
                </p>
                {project.hook_ai_suggestion && project.hook_ai_suggestion !== hook && (
                  <button
                    type="button"
                    onClick={() => setHook(project.hook_ai_suggestion || '')}
                    className="mt-1.5 text-xs text-gray-500 underline underline-offset-2 hover:text-black"
                  >
                    Use AI suggestion: “{project.hook_ai_suggestion}”
                  </button>
                )}
              </Card>

              <div className="flex flex-wrap items-center gap-3">
                <PrimaryButton onClick={handleConfirmHook} loading={busy} disabled={!hook.trim()} icon={<Sparkles size={15} />}>
                  {(project.paragraphs || []).length > 0 ? 'Redraft Letter' : 'Generate Letter'}
                </PrimaryButton>
                {(project.paragraphs || []).length > 0 && (
                  <SecondaryButton onClick={() => reopenStep('letter')} disabled={busy}>
                    Keep the current letter
                  </SecondaryButton>
                )}
              </div>
            </div>
          )}

          {project.stage === 'letter_review' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Letter Paragraphs</h2>
                <span className="text-xs text-gray-400">{totalLetterWords} words total</span>
              </div>
              {(project.samples_used || []).length > 0 && (
                <p className="-mt-2 text-xs text-gray-400">
                  Style references: {project.samples_used.map((s) => s.title).join(', ')}
                </p>
              )}
              {project.paragraphs.map((p) => (
                <ParagraphCard
                  key={p.key}
                  paragraph={p}
                  disabled={busy}
                  onApprove={() => handleApproveParagraph(p.key)}
                  onRegenerate={(feedback) => handleRegenerateParagraph(p.key, feedback)}
                  onUnlock={() => handleUnlockParagraph(p.key)}
                />
              ))}
              <PrimaryButton onClick={handleFinalApprove} loading={busy} disabled={unlockedCount > 0} icon={<Check size={15} />}>
                {unlockedCount > 0 ? `${unlockedCount} paragraph${unlockedCount === 1 ? '' : 's'} left to approve` : 'Final Approve'}
              </PrimaryButton>
            </div>
          )}

          {project.stage === 'letter_approved' && busy && (
            <InterviewLetterLoader label="Generating the general email…" elapsedSecs={elapsedSecs} variant="email" />
          )}

          {project.stage === 'letter_approved' && !busy && (
            <div className="flex flex-col gap-5">
              <ApprovedLetterCard text={project.master_letter || ''} onDownload={() => setDownload({ personalization: null })} />
              {project.sender_name && (
                <p className="text-xs text-gray-400">
                  The cover email will be signed by {project.sender_name}
                  {project.sender_title ? `, ${project.sender_title}` : ''}.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryButton onClick={handleGenerateEmail} loading={busy} icon={<Sparkles size={15} />}>
                  {project.master_email ? 'Regenerate General Email' : 'Generate General Email'}
                </PrimaryButton>
                {project.master_email && (
                  <SecondaryButton onClick={() => reopenStep('email')} disabled={busy}>
                    Keep the current email
                  </SecondaryButton>
                )}
              </div>
            </div>
          )}

          {(project.stage === 'email_review' || project.stage === 'complete') && (
            <div className="flex flex-col gap-5">
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <SectionLabel>
                    {project.stage === 'complete' ? 'Approved General Email' : 'General Email Draft'}
                  </SectionLabel>
                  <CopyButton text={project.master_email || ''} />
                </div>
                <EmailPreview text={project.master_email || ''} />
              </Card>

              {project.stage === 'email_review' && (
                <Card>
                  <Textarea
                    label="Feedback"
                    value={emailFeedback}
                    onChange={(e) => setEmailFeedback(e.target.value)}
                    placeholder="Feedback for regenerating the email (optional)"
                    rows={2}
                  />
                  <div className="mt-3 flex items-center gap-3">
                    <PrimaryButton onClick={handleApproveEmail} loading={busy} icon={<Check size={15} />}>
                      Approve Email
                    </PrimaryButton>
                    <button
                      type="button"
                      onClick={handleRegenerateEmail}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-black disabled:opacity-50"
                    >
                      <RotateCcw size={12} /> Regenerate
                    </button>
                  </div>
                </Card>
              )}

              {project.stage === 'email_review' && (
                <div>
                  <DownloadLetterButton onClick={() => setDownload({ personalization: null })} label="Download Approved Letter" />
                </div>
              )}
            </div>
          )}

          {project.stage === 'complete' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDownload({ personalization: null })}
                  className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
                >
                  <Download size={14} /> Download Letter
                </button>
                <button
                  type="button"
                  onClick={() => setPersonalizeOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-400 hover:shadow-md"
                >
                  <UserPlus size={14} /> Personalize for a Recipient
                </button>
              </div>

              {personalizations.length > 0 && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-gray-900">Personalized Outputs</h2>
                  <div className="flex flex-col gap-3">
                    {personalizations.map((p) => {
                      const isOpen = expandedPersonalizationId === p.id
                      return (
                        <Card key={p.id} className="!p-4 sm:!p-5">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-800">
                              {p.recipient_name || 'Unnamed recipient'}
                              {p.recipient_title ? ` — ${p.recipient_title}` : ''}
                            </span>
                            <span className="text-xs text-gray-400">{formatDayMonthYear(p.created_at)}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                if (isOpen) {
                                  setExpandedPersonalizationId(null)
                                } else {
                                  setExpandedPersonalizationId(p.id)
                                  setPersonalizationView('email')
                                }
                              }}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 transition-colors hover:text-black"
                            >
                              {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                              {isOpen ? 'Hide' : 'View'}
                            </button>
                            <div className="flex items-center gap-2">
                              <CopyButton text={p.email_text} label="Copy email" />
                              <CopyButton text={p.letter_text} label="Copy letter" />
                              <button
                                type="button"
                                onClick={() => setDownload({ personalization: p })}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-black"
                              >
                                <Download size={13} /> Download letter
                              </button>
                            </div>
                          </div>

                          {isOpen && (
                            <div className="mt-4 flex flex-col gap-3 border-t border-[#e5e3df] pt-4">
                              <div className="inline-flex self-start overflow-hidden rounded-lg border border-[#e5e3df]">
                                <button
                                  type="button"
                                  onClick={() => setPersonalizationView('email')}
                                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                    personalizationView === 'email' ? 'bg-black text-white' : 'text-gray-500 hover:text-black'
                                  }`}
                                >
                                  Email
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPersonalizationView('letter')}
                                  className={`border-l border-[#e5e3df] px-3 py-1.5 text-xs font-medium transition-colors ${
                                    personalizationView === 'letter' ? 'bg-black text-white' : 'text-gray-500 hover:text-black'
                                  }`}
                                >
                                  Letter
                                </button>
                              </div>

                              {personalizationView === 'email' ? (
                                <EmailPreview text={p.email_text} />
                              ) : (
                                <div className="rounded-xl border border-[#e5e3df] px-4 py-4 text-sm leading-relaxed text-gray-800 sm:px-5">
                                  <div className="whitespace-pre-wrap">{p.letter_text}</div>
                                </div>
                              )}
                            </div>
                          )}
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )}

              <PersonalizeModal
                open={personalizeOpen}
                onClose={() => setPersonalizeOpen(false)}
                onCreated={(p) => {
                  setPersonalizations((prev) => [p, ...prev])
                  setExpandedPersonalizationId(p.id)
                  setPersonalizationView('email')
                }}
                projectId={project.id}
              />
            </div>
          )}
          </>
        )}
      </div>

      {download?.personalization ? (
        <DownloadTemplateModal
          open
          onClose={() => setDownload(null)}
          baseUrl={`/api/interview-letters/${project.id}/export`}
          extraParams={{ personalization: download.personalization.id }}
          filenameBase={letterDownloadName(project.project_country, {
            name: download.personalization.recipient_name,
            title: download.personalization.recipient_title,
            organisation: download.personalization.recipient_organisation,
          })}
          variantLabel={download.personalization.recipient_name || 'Personalized'}
          variantTone="final"
          defaultTemplateId={guessTemplateId(project.company, project.media_partner)}
        />
      ) : (
        <DownloadTemplateModal
          open={Boolean(download)}
          onClose={() => setDownload(null)}
          baseUrl={`/api/interview-letters/${project.id}/export`}
          fields={[
            { key: 'recipientName', label: 'Recipient name', placeholder: 'e.g. Jane Doe' },
            { key: 'recipientTitle', label: 'Designation', placeholder: 'e.g. Minister of Finance' },
            { key: 'recipientOrganisation', label: 'Company / Ministry', placeholder: 'e.g. Ministry of Finance' },
          ]}
          fieldsHint="Optional. Fill these in to address the letter: they go into the header, the “Dear …,” line and the file name. Leave them blank to get the letter with highlighted placeholders."
          filenameBase={(v) => letterDownloadName(project.project_country, { name: v.recipientName, title: v.recipientTitle, organisation: v.recipientOrganisation })}
          defaultTemplateId={guessTemplateId(project.company, project.media_partner)}
        />
      )}
    </div>
  )
}
