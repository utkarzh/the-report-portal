'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles, Copy, Check, Download, UserPlus, RotateCcw, AlertTriangle,
  ChevronDown, ChevronUp, Mail, Globe2, Newspaper, Loader2, AlertCircle,
} from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import ParagraphCard from '@/components/interview-letters/ParagraphCard'
import PersonalizeModal from '@/components/interview-letters/PersonalizeModal'
import InterviewLetterLoader from '@/components/interview-letters/InterviewLetterLoader'
import DownloadTemplateModal from '@/components/ui/DownloadTemplateModal'
import { useStickToBottom } from '@/lib/use-stick-to-bottom'
import { formatDayMonthYear } from '@/lib/date-format'
import { wordCount, splitEmailSubject } from '@/lib/interview-letters'
import { guessTemplateId } from '@/lib/download-templates/registry'
import type { InterviewLetterProject, InterviewLetterPersonalization } from '@/types'

interface Props {
  project: InterviewLetterProject
  isGenerating: boolean
  isAdmin: boolean
}

type StepState = 'done' | 'active' | 'error' | 'upcoming'

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

function Stepper({ steps }: { steps: { label: string; sub: string; state: StepState }[] }) {
  return (
    <ol className="grid grid-cols-2 gap-2 border-t border-[#eceae5] px-6 py-4 sm:grid-cols-4">
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

export default function InterviewLetterWorkspace({ project: initialProject, isGenerating }: Props) {
  const [project, setProject] = useState(initialProject)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hook, setHook] = useState(project.confirmed_hook || project.hook_input || project.hook_ai_suggestion || '')
  const [emailFeedback, setEmailFeedback] = useState('')
  const [personalizeOpen, setPersonalizeOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [personalizations, setPersonalizations] = useState<InterviewLetterPersonalization[]>([])
  const [expandedPersonalizationId, setExpandedPersonalizationId] = useState<string | null>(null)
  const [personalizationView, setPersonalizationView] = useState<'email' | 'letter'>('email')
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

  const startResearch = useCallback(async () => {
    setBusy(true)
    setRunError(null)
    setStalled(false)
    setStatusText('Researching…')
    try {
      const res = await fetch(`/api/interview-letters/${project.id}/research`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRunError(data.error || 'Research failed')
        setBusy(false)
        return
      }
      await readSSE(res, (data) => {
        const d = data as { status?: string; error?: string; done?: boolean; research?: string[]; hookAiSuggestion?: string }
        if (d.status === 'web_search_start') setStatusText('Searching…')
        else if (d.status === 'researching') setStatusText('Researching…')
        else if (d.status === 'refining') setStatusText('Refining…')
        else if (d.error) setRunError(d.error)
        else if (d.done) {
          setProject((p) => ({
            ...p,
            stage: 'hook_review',
            research: d.research || [],
            hook_ai_suggestion: d.hookAiSuggestion || null,
          }))
          setHook((prev) => prev || d.hookAiSuggestion || '')
        }
      })
    } catch {
      setRunError('Network error during research. Please try again.')
    } finally {
      setBusy(false)
      setStatusText(null)
    }
  }, [project.id])

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
    startedRef.current = false
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
    setProject((p) => ({ ...p, stage: 'letter_review', paragraphs: data.paragraphs, confirmed_hook: hook, hook_source: hookSource }))
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

  const steps = [
    { label: 'Research & Hook', sub: project.stage === 'researching' || project.stage === 'input' ? (statusText || 'Working…') : 'Why-now hook', state: researchStep },
    { label: 'Letter', sub: project.stage === 'letter_review' ? `${totalLetterWords} words` : 'Paragraph by paragraph', state: letterStep },
    { label: 'Email', sub: 'General cover email', state: emailStep },
    { label: 'Send', sub: 'Export & personalize', state: doneStep },
  ]

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
                </div>
              </div>
            </div>
            <span className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${stageMeta.tone}`}>
              {stageMeta.label}
            </span>
          </div>
          <Stepper steps={steps} />
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

        {(project.stage === 'input' || project.stage === 'researching') && !stalled && (
          <InterviewLetterLoader label={statusText || 'Starting research…'} elapsedSecs={elapsedSecs} variant="research" />
        )}

        {project.stage === 'failed' && (
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-[#e5e3df] bg-white p-8 shadow-sm">
            <div className="rounded-full bg-red-50 p-3 text-red-600">
              <AlertCircle size={20} />
            </div>
            <p className="text-sm text-gray-600">{project.error || 'Something went wrong.'}</p>
            <PrimaryButton onClick={startResearch} loading={busy} icon={<RotateCcw size={15} />}>
              Retry Research
            </PrimaryButton>
          </div>
        )}

        {project.stage === 'hook_review' && busy && (
          <InterviewLetterLoader label="Generating the letter…" elapsedSecs={elapsedSecs} variant="letter" />
        )}

        {project.stage === 'hook_review' && !busy && (
          <div className="flex flex-col gap-5">
            <Card>
              <SectionLabel>Research</SectionLabel>
              <div className="flex flex-col gap-2.5">
                {project.research.length === 0 ? (
                  <p className="text-sm text-gray-400">No research bullets came back.</p>
                ) : (
                  project.research.map((bullet, i) => (
                    <p key={i} className="text-sm leading-relaxed text-gray-700">• {bullet}</p>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <Textarea
                label="Why-Now Hook"
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                rows={3}
              />
              <p className="mt-1.5 text-xs text-gray-400">
                {project.hook_input ? 'Your original hook takes priority — edit freely, or use the AI suggestion below.' : 'AI-proposed based on the research above. Edit, replace, or accept it.'}
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

            <PrimaryButton onClick={handleConfirmHook} loading={busy} disabled={!hook.trim()} icon={<Sparkles size={15} />}>
              Generate Letter
            </PrimaryButton>
          </div>
        )}

        {project.stage === 'letter_review' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Letter Paragraphs</h2>
              <span className="text-xs text-gray-400">{totalLetterWords} words total</span>
            </div>
            {project.paragraphs.map((p) => (
              <ParagraphCard
                key={p.key}
                paragraph={p}
                disabled={busy}
                onApprove={() => handleApproveParagraph(p.key)}
                onRegenerate={(feedback) => handleRegenerateParagraph(p.key, feedback)}
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
            <Card tone="emerald">
              <SectionLabel>Approved Letter</SectionLabel>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                {project.master_letter}
              </div>
            </Card>
            {project.sender_name && (
              <p className="text-xs text-gray-400">
                The cover email will be signed by {project.sender_name}
                {project.sender_title ? `, ${project.sender_title}` : ''}.
              </p>
            )}
            <PrimaryButton onClick={handleGenerateEmail} loading={busy} icon={<Sparkles size={15} />}>
              Generate General Email
            </PrimaryButton>
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
          </div>
        )}

        {project.stage === 'complete' && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
              >
                <Download size={14} /> Export Letter
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

            <DownloadTemplateModal
              open={exportOpen}
              onClose={() => setExportOpen(false)}
              baseUrl={`/api/interview-letters/${project.id}/export`}
              filenameBase={`${project.company} — ${project.media_partner} — Interview Letter`}
              defaultTemplateId={guessTemplateId(project.company, project.media_partner)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
