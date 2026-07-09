'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { marked } from 'marked'
import { Download } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import DeleteInterviewButton from '@/components/research/DeleteInterviewButton'
import type { ResearchSession } from '@/types'

marked.use({ gfm: true, breaks: true })

type StreamStatus = 'idle' | 'generating' | 'searching'

interface Props {
  session: ResearchSession
  isGenerating: boolean
  isAdmin?: boolean
}

export default function ResearchOutput({ session, isGenerating, isAdmin = false }: Props) {
  const router = useRouter()

  const [output, setOutput] = useState<string>(session.initial_output || '')
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const hasStartedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Live usage — seeded from the server snapshot, then updated in place as each
  // stream (research + questions) reports its final totals, so the sidebar
  // reflects combined spend without a page reload.
  const [usage, setUsage] = useState({
    tokens_total: session.tokens_total || 0,
    web_searches: session.web_searches || 0,
    cost_usd: Number(session.cost_usd) || 0,
  })

  // Questions state
  const [questions, setQuestions] = useState<string>(session.questions_output || '')
  const [questionsStreaming, setQuestionsStreaming] = useState(false)
  const [questionsError, setQuestionsError] = useState<string | null>(null)
  const [questionsExtra, setQuestionsExtra] = useState('')
  const [showQuestionsForm, setShowQuestionsForm] = useState(false)

  useEffect(() => {
    if (isGenerating && !session.initial_output && !hasStartedRef.current) {
      hasStartedRef.current = true
      startGeneration()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output, questions])

  async function startGeneration() {
    setError(null)
    setStreamStatus('generating')
    setOutput('')

    // Pull and clear the ephemeral additional context that the research form
    // stashed in sessionStorage — used once, never stored server-side.
    let additionalPrompt = ''
    if (typeof window !== 'undefined') {
      additionalPrompt = sessionStorage.getItem(`research-extra:${session.id}`) || ''
      if (additionalPrompt) sessionStorage.removeItem(`research-extra:${session.id}`)
    }

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, additionalPrompt }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Generation failed. Please try again.')
        setStreamStatus('idle')
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const rawData = line.slice(6).trim()
          if (rawData === '[DONE]') break

          try {
            const parsed = JSON.parse(rawData)
            if (parsed.error) {
              setError(parsed.error)
              setStreamStatus('idle')
              return
            }
            if (parsed.status === 'web_search_start') {
              setStreamStatus('searching')
            } else if (parsed.status === 'generating') {
              setStreamStatus('generating')
            } else if (parsed.usage) {
              setUsage(parsed.usage)
            } else if (parsed.text) {
              accumulated += parsed.text
              setOutput(accumulated)
            }
          } catch {}
        }
      }

      router.replace(`/research/${session.id}`)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setStreamStatus('idle')
    }
  }

  async function generateQuestions() {
    setQuestionsError(null)
    setQuestionsStreaming(true)
    setQuestions('')

    const extra = questionsExtra.trim()

    try {
      const res = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, additionalPrompt: extra }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setQuestionsError(data.error || 'Failed to generate questions. Please try again.')
        setQuestionsStreaming(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const rawData = line.slice(6).trim()
          if (rawData === '[DONE]') break

          try {
            const parsed = JSON.parse(rawData)
            if (parsed.error) {
              setQuestionsError(parsed.error)
              setQuestionsStreaming(false)
              return
            }
            if (parsed.usage) {
              setUsage(parsed.usage)
            } else if (parsed.text) {
              accumulated += parsed.text
              setQuestions(accumulated)
            }
          } catch {}
        }
      }

      setQuestionsExtra('')
      setShowQuestionsForm(false)
    } catch {
      setQuestionsError('Network error. Please try again.')
    } finally {
      setQuestionsStreaming(false)
    }
  }

  const isProcessing = streamStatus !== 'idle'
  const researchDone = Boolean(output) && !isProcessing
  const hasQuestions = Boolean(questions)

  return (
    <div className="flex h-full bg-white">
      {/* Left sidebar */}
      <div className="w-60 border-r border-[#e5e3df] flex-shrink-0 flex flex-col bg-[#faf9f7]">
        <div className="p-5 flex-1 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
            Interview Subject
          </p>
          <h2 className="text-sm font-semibold text-gray-900 leading-snug mb-4">
            {session.full_name}
          </h2>

          <div className="space-y-3">
            <InfoRow label="Type" value={session.category_name} />
            <InfoRow label="Title" value={session.title_position} />
            <InfoRow label="Organisation" value={session.company_org} />
            <InfoRow label="Country" value={session.country_focus} />
            <InfoRow label="Publication" value={session.publication} />
            <InfoRow label="Partner Country" value={session.media_partner_country} />
          </div>

          {usage.tokens_total > 0 && (
            <div className="mt-5 pt-4 border-t border-[#e5e3df]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Usage
              </p>
              <p className="text-xs text-gray-500">{formatTokens(usage.tokens_total)} tokens</p>
              {usage.web_searches > 0 && (
                <p className="text-xs text-gray-500">{usage.web_searches} web search{usage.web_searches === 1 ? '' : 'es'}</p>
              )}
              <p className="text-xs text-gray-400">${usage.cost_usd.toFixed(4)}</p>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-[#e5e3df] space-y-4">
          <Link
            href="/research"
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M7.5 1.5L3 6l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            New research
          </Link>

          {isAdmin && (
            <DeleteInterviewButton
              sessionId={session.id}
              interviewTitle={session.full_name}
              redirectTo="/interview"
            />
          )}
        </div>
      </div>

      {/* Main output area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {(isProcessing || questionsStreaming) && (
          <div className="flex items-center gap-2 px-6 py-2 border-b border-[#e5e3df] bg-white flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c8973f] animate-pulse" />
            <span className="text-xs text-gray-500">
              {questionsStreaming
                ? 'Drafting interview questions…'
                : streamStatus === 'searching'
                  ? 'Searching the web for latest information…'
                  : 'Generating…'}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">

            {!output && !isProcessing && (
              <div className="flex flex-col items-center py-20 gap-4">
                <AssistantAvatar size="lg" />
                <p className="text-sm text-gray-500">
                  Ready to research <span className="font-medium text-gray-800">{session.full_name}</span>
                </p>
                <button
                  onClick={startGeneration}
                  className="mt-2 bg-black text-white text-sm font-medium px-6 py-2.5 hover:bg-gray-900 transition-colors"
                >
                  Generate Research
                </button>
              </div>
            )}

            {(output || isProcessing) && (
              <div className="flex gap-4 items-start">
                <AssistantAvatar />
                <div className="flex-1 min-w-0 pt-0.5">
                  {output ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Research</p>
                        {!isProcessing && (
                          <DownloadButton sessionId={session.id} type="research" />
                        )}
                      </div>
                      <div
                        className="prose-research text-sm text-gray-800"
                        dangerouslySetInnerHTML={{ __html: marked.parse(output) as string }}
                      />
                      {isProcessing && <span className="cursor-blink text-gray-300 text-sm select-none">▋</span>}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      {streamStatus === 'searching'
                        ? <span>Searching the web…</span>
                        : <span>Thinking…</span>}
                      <span className="cursor-blink select-none">▋</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="flex gap-3 items-start mt-8">
                <div className="w-7 h-7 rounded-full bg-red-100 flex-shrink-0 flex items-center justify-center mt-0.5">
                  <span className="text-red-500 text-xs font-bold">!</span>
                </div>
                <div>
                  <p className="text-sm text-red-600">{error}</p>
                  {!output && (
                    <button
                      onClick={() => { setError(null); startGeneration() }}
                      className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors underline underline-offset-2"
                    >
                      Try again
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Questions block — shown only after research is done */}
            {researchDone && (
              <div className="mt-10 pt-8 border-t border-[#e5e3df]">
                {hasQuestions ? (
                  <div className="flex gap-4 items-start">
                    <AssistantAvatar />
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                          Interview Questions
                        </p>
                        {!questionsStreaming && (
                          <DownloadButton sessionId={session.id} type="questions" />
                        )}
                      </div>
                      <div
                        className="prose-research text-sm text-gray-800"
                        dangerouslySetInnerHTML={{ __html: marked.parse(questions) as string }}
                      />
                      {questionsStreaming && <span className="cursor-blink text-gray-300 text-sm select-none">▋</span>}
                    </div>
                  </div>
                ) : questionsStreaming ? (
                  <div className="flex gap-4 items-start">
                    <AssistantAvatar />
                    <div className="flex items-center gap-2 text-sm text-gray-400 pt-1.5">
                      <span>Drafting questions…</span>
                      <span className="cursor-blink select-none">▋</span>
                    </div>
                  </div>
                ) : null}

                {/* Action area below questions */}
                {!questionsStreaming && (
                  <div className="mt-8">
                    {!showQuestionsForm ? (
                      <div className="flex flex-wrap gap-3">
                        {!hasQuestions ? (
                          <button
                            onClick={() => setShowQuestionsForm(true)}
                            className="bg-black text-white text-xs font-medium uppercase tracking-wider px-5 py-2.5 hover:bg-gray-900 transition-colors"
                          >
                            Generate Questions
                          </button>
                        ) : (
                          <button
                            onClick={() => setShowQuestionsForm(true)}
                            className="bg-white border border-[#e5e3df] text-gray-700 text-xs font-medium uppercase tracking-wider px-5 py-2.5 hover:bg-gray-50 transition-colors"
                          >
                            Regenerate Questions
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="bg-[#faf9f7] border border-[#e5e3df] p-5">
                        <Textarea
                          label={hasQuestions ? 'What to improve' : 'Additional context'}
                          hint="optional"
                          placeholder={
                            hasQuestions
                              ? 'e.g. Make the questions sharper. Focus more on financials. Avoid yes/no questions.'
                              : 'e.g. Focus on policy positions. Ask about recent M&A activity.'
                          }
                          value={questionsExtra}
                          onChange={(e) => setQuestionsExtra(e.target.value)}
                          rows={3}
                        />
                        <div className="flex gap-3 mt-4">
                          <button
                            onClick={generateQuestions}
                            className="bg-black text-white text-xs font-medium uppercase tracking-wider px-5 py-2.5 hover:bg-gray-900 transition-colors"
                          >
                            {hasQuestions ? 'Regenerate' : 'Generate'}
                          </button>
                          <button
                            onClick={() => {
                              setShowQuestionsForm(false)
                              setQuestionsExtra('')
                            }}
                            className="text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900 px-3 py-2.5 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {questionsError && (
                  <div className="flex gap-3 items-start mt-6">
                    <div className="w-7 h-7 rounded-full bg-red-100 flex-shrink-0 flex items-center justify-center mt-0.5">
                      <span className="text-red-500 text-xs font-bold">!</span>
                    </div>
                    <p className="text-sm text-red-600">{questionsError}</p>
                  </div>
                )}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

function AssistantAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const cls = size === 'lg'
    ? 'w-10 h-10 text-xs'
    : 'w-7 h-7 text-[10px]'
  return (
    <div className={`${cls} rounded-full bg-[#c8973f] flex-shrink-0 flex items-center justify-center text-white font-semibold`}>
      AI
    </div>
  )
}

function DownloadButton({
  sessionId,
  type,
}: {
  sessionId: string
  type: 'research' | 'questions'
}) {
  const href = `/api/sessions/${sessionId}/download?type=${type}`
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400 hover:text-gray-900 transition-colors"
    >
      <Download size={11} strokeWidth={2} />
      Download
    </a>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-xs text-gray-700 mt-0.5">{value}</p>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
