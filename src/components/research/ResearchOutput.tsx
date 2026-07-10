'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { marked } from 'marked'
import { Download, MessagesSquare, FileText, ListChecks, Sparkles, WandSparkles, Copy, Check, ArrowLeft } from 'lucide-react'
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
  // True when this client is watching a generation that was started elsewhere
  // (the user navigated away and came back) — we poll instead of streaming.
  const [reconnecting, setReconnecting] = useState(false)
  const hasStartedRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Live usage — seeded from the server snapshot, then updated in place as each
  // stream (research + questions) reports its final totals, so the sidebar
  // reflects combined spend without a page reload.
  const [usage, setUsage] = useState({
    tokens_total: session.tokens_total || 0,
    web_searches: session.web_searches || 0,
    cost_usd: Number(session.cost_usd) || 0,
  })

  // Research regenerate state (mirror of the questions flow)
  const [researchExtra, setResearchExtra] = useState('')
  const [showResearchForm, setShowResearchForm] = useState(false)

  // Questions state
  const [questions, setQuestions] = useState<string>(session.questions_output || '')
  const [questionsStreaming, setQuestionsStreaming] = useState(false)
  const [questionsError, setQuestionsError] = useState<string | null>(null)
  const [questionsExtra, setQuestionsExtra] = useState('')
  const [showQuestionsForm, setShowQuestionsForm] = useState(false)

  useEffect(() => {
    if (hasStartedRef.current) return
    if (isGenerating && !session.initial_output) {
      // This client initiated the run → stream it.
      hasStartedRef.current = true
      startGeneration()
    } else if (!isGenerating && session.status === 'generating') {
      // A run is in progress but was started elsewhere (user came back) → we
      // can't re-attach to that stream, so poll the row until it settles.
      hasStartedRef.current = true
      startReconnect()
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output, questions])

  // extraOverride is passed when the user regenerates with "what to improve"
  // guidance; otherwise we use the one-time context stashed by the research form.
  async function startGeneration(extraOverride?: string) {
    setError(null)
    setStreamStatus('generating')
    setOutput('')
    setShowResearchForm(false)
    setResearchExtra('')

    let additionalPrompt = (extraOverride || '').trim()
    if (!additionalPrompt && typeof window !== 'undefined') {
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

  // Watch a generation running in the background (started in another tab/visit).
  // No live token stream is available to a late-joining client, so we poll the
  // session row every few seconds and load the result once it lands.
  function startReconnect() {
    setReconnecting(true)
    setStreamStatus('generating')

    const poll = async () => {
      try {
        const res = await fetch(`/api/sessions/${session.id}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.usage) setUsage(data.usage)

        if (data.status === 'complete') {
          if (data.initial_output) setOutput(data.initial_output)
          if (data.questions_output) setQuestions(data.questions_output)
          stopReconnect()
        } else if (data.status === 'failed') {
          setError('Generation failed. Please try again.')
          stopReconnect()
        }
      } catch {
        /* transient — keep polling */
      }
    }

    poll()
    pollRef.current = setInterval(poll, 3000)
  }

  function stopReconnect() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setReconnecting(false)
    setStreamStatus('idle')
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

  const streamingLabel = reconnecting
    ? 'Generating…'
    : streamStatus === 'searching'
    ? 'Searching…'
    : 'Generating…'

  return (
    <div className="flex h-full bg-[#f0efec]">
      {/* Subject side panel */}
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-[#e5e3df] bg-white">
        <div className="flex-1 overflow-y-auto p-5">
          <Link
            href="/interview"
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-gray-700"
          >
            <ArrowLeft size={13} />
            <span>Interviews</span>
          </Link>

          <div className="mt-5 flex items-center gap-2.5">
            <div className="flex-shrink-0 rounded-lg bg-black p-2 text-white">
              <MessagesSquare size={15} />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Interview subject</p>
          </div>
          <h1 className="mt-3 text-sm font-semibold leading-snug text-gray-900">{session.full_name}</h1>

          <div className="mt-5 space-y-3.5">
            <InfoRow label="Category" value={session.category_name} />
            <InfoRow label="Title / Position" value={session.title_position} />
            <InfoRow label="Organisation" value={session.company_org} />
            <InfoRow label="Country" value={session.country_focus} />
            <InfoRow label="Publication" value={session.publication} />
            <InfoRow label="Partner Country" value={session.media_partner_country} />
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
                {/* Cost is billing info — admins only. */}
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
            <DeleteInterviewButton
              sessionId={session.id}
              interviewTitle={session.full_name}
              redirectTo="/interview"
            />
          </div>
        )}
      </aside>

      {/* Output — scrolls independently */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">

        {/* Research card */}
        <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex-shrink-0 rounded-lg border border-[#e5e3df] bg-[#f7f6f3] p-2 text-gray-700">
                <FileText size={15} />
              </div>
              <div>
                <h2 className="text-sm font-semibold leading-tight text-gray-900">Background Research</h2>
                <p className="mt-0.5 text-[11px] leading-tight text-gray-400">AI-generated profile &amp; context</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {isProcessing ? (
                <span className="flex items-center gap-2 pr-2 text-xs text-gray-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
                  {streamingLabel}
                </span>
              ) : output ? (
                <>
                  <CopyButton text={output} />
                  <a
                    href={`/api/sessions/${session.id}/download?type=research`}
                    download
                    title="Download research (.docx)"
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900"
                  >
                    <Download size={13} />
                    <span>Download</span>
                  </a>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-4">
            {output ? (
              <>
                <div
                  className="prose-research text-sm text-gray-800"
                  dangerouslySetInnerHTML={{ __html: marked.parse(output) as string }}
                />
                {isProcessing && <span className="cursor-blink select-none text-gray-300">▋</span>}
              </>
            ) : isProcessing ? (
              <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
                {reconnecting ? (
                  <span>This research is generating in the background — it will appear here automatically…</span>
                ) : streamStatus === 'searching' ? (
                  <span>Searching the web for the latest information…</span>
                ) : (
                  <span>Researching the interviewee…</span>
                )}
                <span className="cursor-blink select-none">▋</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-10 text-center">
                <div className="rounded-full bg-[#f7f6f3] p-3 text-gray-400">
                  <Sparkles size={20} />
                </div>
                <p className="text-sm text-gray-500">
                  Ready to research <span className="font-medium text-gray-800">{session.full_name}</span>
                </p>
                <button
                  onClick={() => startGeneration()}
                  className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
                >
                  <Sparkles size={15} />
                  Generate Research
                </button>
              </div>
            )}

            {/* Regenerate research with optional "what to improve" guidance */}
            {researchDone && (
              <div className="mt-6 border-t border-[#e5e3df] pt-5">
                {!showResearchForm ? (
                  <button
                    onClick={() => setShowResearchForm(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
                  >
                    <WandSparkles size={15} />
                    Regenerate research
                  </button>
                ) : (
                  <div className="rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-5">
                    <Textarea
                      label="What to improve"
                      hint="optional"
                      placeholder="e.g. Focus more on recent financials. Add their regulatory history. Double-check their current role."
                      value={researchExtra}
                      onChange={(e) => setResearchExtra(e.target.value)}
                      rows={3}
                    />
                    <div className="mt-4 flex gap-3">
                      <button
                        onClick={() => startGeneration(researchExtra)}
                        className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900"
                      >
                        <WandSparkles size={15} />
                        Regenerate
                      </button>
                      <button
                        onClick={() => { setShowResearchForm(false); setResearchExtra('') }}
                        className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span>{error}</span>
                {!output && (
                  <button
                    onClick={() => { setError(null); startGeneration() }}
                    className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-red-700 underline underline-offset-2 hover:text-red-900"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Interview questions card — after research is done */}
        {researchDone && (
          <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex-shrink-0 rounded-lg border border-[#e5e3df] bg-[#f7f6f3] p-2 text-gray-700">
                  <ListChecks size={15} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold leading-tight text-gray-900">Interview Questions</h2>
                  <p className="mt-0.5 text-[11px] leading-tight text-gray-400">Tailored to the research above</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {questionsStreaming ? (
                  <span className="flex items-center gap-2 pr-2 text-xs text-gray-500">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
                    Drafting…
                  </span>
                ) : hasQuestions ? (
                  <>
                    <CopyButton text={questions} />
                    <a
                      href={`/api/sessions/${session.id}/download?type=questions`}
                      download
                      title="Download questions (.docx)"
                      className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900"
                    >
                      <Download size={13} />
                      <span>Download</span>
                    </a>
                  </>
                ) : null}
              </div>
            </div>

            <div className="mt-4">
              {hasQuestions ? (
                <>
                  <div
                    className="prose-research text-sm text-gray-800"
                    dangerouslySetInnerHTML={{ __html: marked.parse(questions) as string }}
                  />
                  {questionsStreaming && <span className="cursor-blink select-none text-gray-300">▋</span>}
                </>
              ) : questionsStreaming ? (
                <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
                  <span>Drafting interview questions…</span>
                  <span className="cursor-blink select-none">▋</span>
                </div>
              ) : null}

              {!questionsStreaming && (
                <div className={hasQuestions ? 'mt-6 border-t border-[#e5e3df] pt-5' : ''}>
                  {!showQuestionsForm ? (
                    <button
                      onClick={() => setShowQuestionsForm(true)}
                      className={
                        hasQuestions
                          ? 'inline-flex items-center gap-2 rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200'
                          : 'inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md'
                      }
                    >
                      <WandSparkles size={15} />
                      {hasQuestions ? 'Regenerate questions' : 'Generate questions'}
                    </button>
                  ) : (
                    <div className="rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-5">
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
                      <div className="mt-4 flex gap-3">
                        <button
                          onClick={generateQuestions}
                          className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900"
                        >
                          <WandSparkles size={15} />
                          {hasQuestions ? 'Regenerate' : 'Generate'}
                        </button>
                        <button
                          onClick={() => {
                            setShowQuestionsForm(false)
                            setQuestionsExtra('')
                          }}
                          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {questionsError && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span>{questionsError}</span>
                  <button
                    onClick={generateQuestions}
                    className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-red-700 underline underline-offset-2 hover:text-red-900"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}

// Copies text with brief "Copied" feedback — mirrors the transcription workspace.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900"
    >
      {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
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
