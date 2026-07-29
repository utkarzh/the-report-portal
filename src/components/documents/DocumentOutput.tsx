'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { marked } from 'marked'
import { Download, FileText, Sparkles, WandSparkles, Copy, Check, ArrowLeft } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import AiDisclaimerModal, { useAiDisclaimer } from '@/components/ui/AiDisclaimerModal'
import DeleteDocumentButton from '@/components/documents/DeleteDocumentButton'
import { getDocConfig } from '@/lib/documents'
import type { DocumentSession } from '@/types'

marked.use({ gfm: true, breaks: true })

type StreamStatus = 'idle' | 'generating' | 'searching'

interface Props {
  session: DocumentSession
  isGenerating: boolean
  isAdmin?: boolean
}

export default function DocumentOutput({ session, isGenerating, isAdmin = false }: Props) {
  const router = useRouter()
  const config = getDocConfig(session.doc_type)

  const [output, setOutput] = useState<string>(session.output || '')
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  // The document isn't finished — there's more to write and the user can click
  // Continue to extend it. Seeded true when we reopen a run left mid-way.
  const [needsContinue, setNeedsContinue] = useState<boolean>(
    session.status === 'generating' && Boolean(session.output),
  )
  const hasStartedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  // True while a "Continue" pass is running, so the AI disclaimer doesn't re-pop
  // on every Continue click — only on a fresh generation / regenerate.
  const isContinueRef = useRef(false)

  const [usage, setUsage] = useState({
    tokens_total: session.tokens_total || 0,
    web_searches: session.web_searches || 0,
    cost_usd: Number(session.cost_usd) || 0,
  })

  const [extra, setExtra] = useState('')
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    if (hasStartedRef.current) return
    if (isGenerating && !session.output) {
      // Fresh generation kicked off from the "new" flow — generate the first
      // part automatically. If it isn't the whole document, we then show a
      // Continue button rather than auto-looping.
      hasStartedRef.current = true
      generateChunk('fresh')
    }
    // Reopened mid-run (status 'generating', output already saved): we DON'T
    // auto-continue — `needsContinue` is seeded true, so the Continue button
    // shows and the user decides when to spend more.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output])

  // Generate ONE part of the document, streamed. The server writes as much as
  // it can before a soft deadline (under the platform's function-timeout cap),
  // persisting as it goes, then stops. If the document isn't finished we show a
  // Continue button — the user controls how long (and how costly) it gets, and
  // nothing is lost between passes even on a hard timeout (the server saves
  // incrementally; on any connection drop we recover the saved text below).
  async function generateChunk(mode: 'fresh' | 'continue' | 'regenerate') {
    const isContinue = mode === 'continue'
    isContinueRef.current = isContinue
    setError(null)
    setStreamStatus('generating')
    setShowForm(false)
    setNeedsContinue(false)
    const additionalPrompt = mode === 'regenerate' ? extra.trim() : ''
    // Continue streams on TOP of the saved text; fresh/regenerate start over.
    const priorText = isContinue ? output : ''
    if (!isContinue) setOutput('')

    try {
      const res = await fetch(`/api/documents/${session.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ continue: isContinue, additionalPrompt }),
      })
      // Pre-flight errors (budget/permission/etc.) come back as JSON, not SSE.
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        if (res.status === 402 || res.status === 403) {
          setError(d.error || 'Generation is not available.')
          setStreamStatus('idle')
          return
        }
        throw new Error(d.error || 'Generation failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamed = priorText
      let finalDone: boolean | undefined
      let streamError: string | undefined

      // Parse the SSE frames: each is `data: <json|[DONE]>\n\n`.
      readLoop: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''
        for (const frame of frames) {
          const line = frame.startsWith('data: ') ? frame.slice(6) : frame.trim()
          if (!line || line === '[DONE]') continue
          let payload: { text?: string; usage?: typeof usage; done?: boolean; output?: string; error?: string }
          try { payload = JSON.parse(line) } catch { continue }
          if (payload.error) { streamError = payload.error; break readLoop }
          if (payload.text) { streamed += payload.text; setOutput(streamed) }
          if (payload.usage) setUsage(payload.usage)
          if (typeof payload.done === 'boolean') {
            finalDone = payload.done
            if (typeof payload.output === 'string') { streamed = payload.output; setOutput(streamed) }
          }
        }
      }

      if (streamError) throw new Error(streamError)

      setStreamStatus('idle')
      if (finalDone === true) {
        setExtra('')
        setNeedsContinue(false)
        router.refresh()
      } else if (finalDone === false || streamed.trim()) {
        // Cut off at the soft deadline (or the stream ended mid-document) —
        // there's more to write.
        setNeedsContinue(true)
      } else {
        // Stream closed without any verdict or text — recover saved state.
        const recovered = await recoverSaved()
        if (!recovered) setError('Generation failed. Please try again.')
      }
    } catch (e) {
      // The connection may have dropped because the platform hard-killed the
      // function (e.g. a slow pass overran the timeout). The server persists
      // incrementally, so pull the latest saved text and offer Continue rather
      // than losing what was written.
      const recovered = await recoverSaved()
      if (!recovered) {
        setError(e instanceof Error ? e.message : 'Generation failed. Please try again.')
      }
      setStreamStatus('idle')
    }
  }

  // Fetch the last saved state after a dropped stream. Returns true if it found
  // usable saved text (and updated the UI), false otherwise.
  async function recoverSaved(): Promise<boolean> {
    try {
      const res = await fetch(`/api/documents/${session.id}`)
      if (!res.ok) return false
      const d = (await res.json()) as { status?: string; output?: string; usage?: typeof usage }
      if (typeof d.output === 'string' && d.output.trim()) {
        setOutput(d.output)
        if (d.usage) setUsage(d.usage)
        if (d.status === 'complete') {
          setNeedsContinue(false)
          router.refresh()
        } else {
          setNeedsContinue(true)
        }
        return true
      }
    } catch {
      /* fall through to error */
    }
    return false
  }

  const isProcessing = streamStatus !== 'idle'
  // "done" = a complete document (nothing left to continue). A partial document
  // waiting on Continue is NOT done.
  const done = Boolean(output) && !isProcessing && !needsContinue
  const streamingLabel = 'Generating…'

  // Fact-checking reminder — pops on a fresh generation / regenerate, but NOT
  // on Continue passes (would be annoying to re-confirm every click).
  const disclaimer = useAiDisclaimer(isProcessing && !isContinueRef.current)

  return (
    <div className="flex h-full bg-[#f0efec]">
      <AiDisclaimerModal open={disclaimer.open} onClose={disclaimer.dismiss} />
      {/* Side panel */}
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-[#e5e3df] bg-white">
        <div className="flex-1 overflow-y-auto p-5">
          <Link
            href={`/${config.slug}`}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-gray-700"
          >
            <ArrowLeft size={13} />
            <span>{config.labelPlural}</span>
          </Link>

          <div className="mt-5 flex items-center gap-2.5">
            <div className="flex-shrink-0 rounded-lg bg-black p-2 text-white">
              <FileText size={15} />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{config.label}</p>
          </div>
          <h1 className="mt-3 text-sm font-semibold leading-snug text-gray-900">{session.title}</h1>

          <div className="mt-5 space-y-3.5">
            <InfoRow label="Project Country" value={session.project_country} />
            <InfoRow label="Media Partner" value={session.media_partner} />
            <InfoRow label="Media Country" value={session.media_country} />
            <InfoRow label="Additional Context" value={session.additional_context} />
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
            <DeleteDocumentButton
              documentId={session.id}
              documentTitle={session.title}
              redirectTo={`/${config.slug}`}
            />
          </div>
        )}
      </aside>

      {/* Output */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
          <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex-shrink-0 rounded-lg border border-[#e5e3df] bg-[#f7f6f3] p-2 text-gray-700">
                  <FileText size={15} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold leading-tight text-gray-900">{config.label}</h2>
                  <p className="mt-0.5 text-[11px] leading-tight text-gray-400">AI-generated document</p>
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
                      href={`/api/documents/${session.id}/download`}
                      download
                      title="Download (.docx)"
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
                  <span>Generating the {config.label.toLowerCase()} — a full document builds in stages and can take a few minutes…</span>
                  <span className="cursor-blink select-none">▋</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                  <div className="rounded-full bg-[#f7f6f3] p-3 text-gray-400">
                    <Sparkles size={20} />
                  </div>
                  <p className="text-sm text-gray-500">Ready to generate this {config.label.toLowerCase()}.</p>
                  <button
                    onClick={() => generateChunk('fresh')}
                    className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
                  >
                    <Sparkles size={15} />
                    Generate {config.label}
                  </button>
                </div>
              )}

              {/* Continue — the document isn't finished; extend it on demand. */}
              {needsContinue && !isProcessing && (
                <div className="mt-6 border-t border-[#e5e3df] pt-5">
                  <p className="mb-3 text-sm text-gray-500">
                    The {config.label.toLowerCase()} isn’t finished yet — the draft so far is saved. Click Continue to generate the next part, or download what you have.
                  </p>
                  <button
                    onClick={() => generateChunk('continue')}
                    className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
                  >
                    <Sparkles size={15} />
                    Continue
                  </button>
                </div>
              )}

              {/* Regenerate with optional feedback (overwrites the saved output) */}
              {done && (
                <div className="mt-6 border-t border-[#e5e3df] pt-5">
                  {!showForm ? (
                    <button
                      onClick={() => setShowForm(true)}
                      className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
                    >
                      <WandSparkles size={15} />
                      Regenerate
                    </button>
                  ) : (
                    <div className="rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-5">
                      <Textarea
                        label="Feedback"
                        hint="optional"
                        placeholder="e.g. Add more recent figures. Expand the competitive section. Tighten the executive summary."
                        value={extra}
                        onChange={(e) => setExtra(e.target.value)}
                        rows={3}
                      />
                      <div className="mt-4 flex gap-3">
                        <button
                          onClick={() => generateChunk('regenerate')}
                          className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900"
                        >
                          <WandSparkles size={15} />
                          Regenerate
                        </button>
                        <button
                          onClick={() => { setShowForm(false); setExtra('') }}
                          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && !isProcessing && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span>{error}</span>
                  <button
                    onClick={() => { setError(null); generateChunk(output ? 'continue' : 'fresh') }}
                    className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-red-700 underline underline-offset-2 hover:text-red-900"
                  >
                    {output ? 'Continue' : 'Try again'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}

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
      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug text-gray-700">{value}</p>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
