'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { marked } from 'marked'
import { Download, FileText, Sparkles, WandSparkles, Copy, Check, ArrowLeft } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
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
  const [reconnecting, setReconnecting] = useState(false)
  const hasStartedRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

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
      hasStartedRef.current = true
      startGeneration()
    } else if (!isGenerating && session.status === 'generating') {
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
  }, [output])

  async function startGeneration(extraOverride?: string) {
    setError(null)
    setStreamStatus('generating')
    setOutput('')
    setShowForm(false)
    const additionalPrompt = (extraOverride || '').trim()

    try {
      const res = await fetch(`/api/documents/${session.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additionalPrompt }),
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

      router.replace(`/${config.slug}/${session.id}`)
      setExtra('')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setStreamStatus('idle')
    }
  }

  function startReconnect() {
    setReconnecting(true)
    setStreamStatus('generating')
    const poll = async () => {
      try {
        const res = await fetch(`/api/documents/${session.id}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.usage) setUsage(data.usage)
        if (data.status === 'complete') {
          if (data.output) setOutput(data.output)
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

  const isProcessing = streamStatus !== 'idle'
  const done = Boolean(output) && !isProcessing
  const streamingLabel = streamStatus === 'searching' ? 'Searching…' : 'Generating…'

  return (
    <div className="flex h-full bg-[#f0efec]">
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
      <div className="flex-1 overflow-y-auto">
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
                  {reconnecting ? (
                    <span>This {config.label.toLowerCase()} is generating in the background — it will appear here automatically…</span>
                  ) : streamStatus === 'searching' ? (
                    <span>Searching the web for the latest information…</span>
                  ) : (
                    <span>Generating the {config.label.toLowerCase()}…</span>
                  )}
                  <span className="cursor-blink select-none">▋</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                  <div className="rounded-full bg-[#f7f6f3] p-3 text-gray-400">
                    <Sparkles size={20} />
                  </div>
                  <p className="text-sm text-gray-500">Ready to generate this {config.label.toLowerCase()}.</p>
                  <button
                    onClick={() => startGeneration()}
                    className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
                  >
                    <Sparkles size={15} />
                    Generate {config.label}
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
                          onClick={() => startGeneration(extra)}
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
