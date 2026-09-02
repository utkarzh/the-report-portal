'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Copy, Check, Download, UserPlus, RotateCcw, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import ParagraphCard from '@/components/interview-letters/ParagraphCard'
import PersonalizeModal from '@/components/interview-letters/PersonalizeModal'
import InterviewLetterLoader from '@/components/interview-letters/InterviewLetterLoader'
import { useStickToBottom } from '@/lib/use-stick-to-bottom'
import { wordCount, splitEmailSubject } from '@/lib/interview-letters'
import type { InterviewLetterProject, InterviewLetterPersonalization } from '@/types'

interface Props {
  project: InterviewLetterProject
  isGenerating: boolean
  isAdmin: boolean
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
      className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-black transition-colors"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// The email is a condensed version of the letter plus a subject line (see
// EMAIL_SYSTEM in the email route) — pulling the subject into its own row
// makes that one real difference visible instead of burying it in the body.
function EmailPreview({ text }: { text: string }) {
  const { subject, body } = splitEmailSubject(text)
  return (
    <div className="border border-[#e5e3df]">
      {subject && (
        <div className="px-4 py-3 sm:px-5 border-b border-[#e5e3df] bg-[#faf9f7] flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 flex-shrink-0">Subject</span>
          <span className="text-sm font-medium text-gray-900">{subject}</span>
        </div>
      )}
      <div className="px-4 py-4 sm:px-5 whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">{body}</div>
    </div>
  )
}

export default function InterviewLetterWorkspace({ project: initialProject, isGenerating, isAdmin }: Props) {
  const router = useRouter()
  const [project, setProject] = useState(initialProject)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hook, setHook] = useState(project.confirmed_hook || project.hook_input || project.hook_ai_suggestion || '')
  const [emailFeedback, setEmailFeedback] = useState('')
  const [personalizeOpen, setPersonalizeOpen] = useState(false)
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

  return (
    <div ref={scrollProps.ref} onScroll={scrollProps.onScroll} onWheel={scrollProps.onWheel} className="h-full overflow-y-auto p-6 sm:p-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{project.company} — {project.media_partner}</h1>
          <p className="text-sm text-gray-500 mt-1">{project.project_country}{project.media_partner_country ? ` · ${project.media_partner_country}` : ''}</p>
        </div>

        {runError && (
          <div className="p-4 bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
            <span>{runError}</span>
          </div>
        )}

        {stalled && (
          <div className="p-4 bg-amber-50 border border-amber-200 text-sm text-amber-700 flex items-center justify-between gap-3">
            <span>This step seems to have stalled.</span>
            <Button type="button" size="sm" onClick={handleRetryStalled}>Retry</Button>
          </div>
        )}

        {(project.stage === 'input' || project.stage === 'researching') && !stalled && (
          <InterviewLetterLoader label={statusText || 'Starting research…'} elapsedSecs={elapsedSecs} variant="research" />
        )}

        {project.stage === 'failed' && (
          <div className="flex flex-col gap-4">
            <div className="p-4 bg-red-50 border border-red-200 text-sm text-red-700">
              {project.error || 'Something went wrong.'}
            </div>
            <Button type="button" onClick={startResearch} loading={busy}>Retry Research</Button>
          </div>
        )}

        {project.stage === 'hook_review' && busy && (
          <InterviewLetterLoader label="Generating the letter…" elapsedSecs={elapsedSecs} variant="letter" />
        )}

        {project.stage === 'hook_review' && !busy && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Research</h2>
              <div className="bg-white border border-[#e5e3df] p-4 sm:p-5 flex flex-col gap-2.5">
                {project.research.length === 0 ? (
                  <p className="text-sm text-gray-400">No research bullets came back.</p>
                ) : (
                  project.research.map((bullet, i) => (
                    <p key={i} className="text-sm text-gray-700 leading-relaxed">• {bullet}</p>
                  ))
                )}
              </div>
            </div>

            <div>
              <Textarea
                label="Why-Now Hook"
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                rows={3}
              />
              <p className="text-xs text-gray-400 mt-1.5">
                {project.hook_input ? 'Your original hook takes priority — edit freely, or use the AI suggestion below.' : 'AI-proposed based on the research above. Edit, replace, or accept it.'}
              </p>
              {project.hook_ai_suggestion && project.hook_ai_suggestion !== hook && (
                <button
                  type="button"
                  onClick={() => setHook(project.hook_ai_suggestion || '')}
                  className="text-xs text-gray-500 hover:text-black underline underline-offset-2 mt-1.5"
                >
                  Use AI suggestion: “{project.hook_ai_suggestion}”
                </button>
              )}
            </div>

            <Button type="button" onClick={handleConfirmHook} loading={busy} disabled={!hook.trim()} arrow>
              Generate Letter
            </Button>
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
            <Button type="button" onClick={handleFinalApprove} loading={busy} disabled={unlockedCount > 0} arrow>
              {unlockedCount > 0 ? `${unlockedCount} paragraph${unlockedCount === 1 ? '' : 's'} left to approve` : 'Final Approve'}
            </Button>
          </div>
        )}

        {project.stage === 'letter_approved' && busy && (
          <InterviewLetterLoader label="Generating the general email…" elapsedSecs={elapsedSecs} variant="email" />
        )}

        {project.stage === 'letter_approved' && !busy && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Approved Letter</h2>
              <div className="bg-white border border-emerald-200 p-4 sm:p-5 whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                {project.master_letter}
              </div>
            </div>
            <Button type="button" onClick={handleGenerateEmail} loading={busy} arrow>
              <Sparkles size={14} className="mr-1.5 inline" /> Generate General Email
            </Button>
          </div>
        )}

        {(project.stage === 'email_review' || project.stage === 'complete') && (
          <div className="flex flex-col gap-5">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  {project.stage === 'complete' ? 'Approved General Email' : 'General Email Draft'}
                </h2>
                <CopyButton text={project.master_email || ''} />
              </div>
              <EmailPreview text={project.master_email || ''} />
            </div>

            {project.stage === 'email_review' && (
              <div className="flex flex-col gap-3">
                <Textarea
                  label="Feedback"
                  value={emailFeedback}
                  onChange={(e) => setEmailFeedback(e.target.value)}
                  placeholder="Feedback for regenerating the email (optional)"
                  rows={2}
                />
                <div className="flex items-center gap-3">
                  <Button type="button" onClick={handleApproveEmail} loading={busy} arrow>
                    Approve Email
                  </Button>
                  <button
                    type="button"
                    onClick={handleRegenerateEmail}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-black transition-colors disabled:opacity-50"
                  >
                    <RotateCcw size={12} /> Regenerate
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {project.stage === 'complete' && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <a
                href={`/api/interview-letters/${project.id}/export`}
                className="inline-flex items-center gap-2 text-xs font-medium tracking-wider uppercase bg-black text-white px-4 py-2.5 hover:bg-gray-900 transition-colors"
              >
                <Download size={13} /> Export Letter (.docx)
              </a>
              <button
                type="button"
                onClick={() => setPersonalizeOpen(true)}
                className="inline-flex items-center gap-2 text-xs font-medium tracking-wider uppercase border border-[#e5e3df] px-4 py-2.5 hover:border-gray-400 transition-colors"
              >
                <UserPlus size={13} /> Personalize for a Recipient
              </button>
            </div>

            {personalizations.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-900 mb-3">Personalized Outputs</h2>
                <div className="flex flex-col gap-3">
                  {personalizations.map((p) => {
                    const isOpen = expandedPersonalizationId === p.id
                    return (
                      <div key={p.id} className="bg-white border border-[#e5e3df] p-4 sm:p-5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-800">
                            {p.recipient_name || 'Unnamed recipient'}
                            {p.recipient_title ? ` — ${p.recipient_title}` : ''}
                          </span>
                          <span className="text-xs text-gray-400">{new Date(p.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
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
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-black transition-colors"
                          >
                            {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            {isOpen ? 'Hide' : 'View'}
                          </button>
                          <div className="flex items-center gap-4">
                            <CopyButton text={p.email_text} label="Copy email" />
                            <CopyButton text={p.letter_text} label="Copy letter" />
                          </div>
                        </div>

                        {isOpen && (
                          <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-[#e5e3df]">
                            <div className="inline-flex self-start border border-[#e5e3df]">
                              <button
                                type="button"
                                onClick={() => setPersonalizationView('email')}
                                className={`px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                                  personalizationView === 'email' ? 'bg-black text-white' : 'text-gray-500 hover:text-black'
                                }`}
                              >
                                Email
                              </button>
                              <button
                                type="button"
                                onClick={() => setPersonalizationView('letter')}
                                className={`px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider border-l border-[#e5e3df] transition-colors ${
                                  personalizationView === 'letter' ? 'bg-black text-white' : 'text-gray-500 hover:text-black'
                                }`}
                              >
                                Letter
                              </button>
                            </div>

                            {personalizationView === 'email' ? (
                              <EmailPreview text={p.email_text} />
                            ) : (
                              <div className="border border-[#e5e3df] px-4 py-4 sm:px-5 whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                                {p.letter_text}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
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

        {isAdmin && (
          <button
            type="button"
            onClick={() => router.refresh()}
            className="text-xs text-gray-400 hover:text-gray-600 self-start mt-4"
          >
            Refresh
          </button>
        )}
      </div>
    </div>
  )
}
