'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { marked } from 'marked'
import type { ResearchSession } from '@/types'

marked.use({ gfm: true, breaks: true })

type StreamStatus = 'idle' | 'generating' | 'searching'

interface Props {
  session: ResearchSession
  isGenerating: boolean
}

export default function ResearchOutput({ session, isGenerating }: Props) {
  const router = useRouter()

  const [output, setOutput] = useState<string>(session.initial_output || '')
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const hasStartedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isGenerating && !session.initial_output && !hasStartedRef.current) {
      hasStartedRef.current = true
      startGeneration()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output])

  async function startGeneration() {
    setError(null)
    setStreamStatus('generating')
    setOutput('')

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
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

  const isProcessing = streamStatus !== 'idle'

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

          {session.tokens_total > 0 && (
            <div className="mt-5 pt-4 border-t border-[#e5e3df]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Usage
              </p>
              <p className="text-xs text-gray-500">{formatTokens(session.tokens_total)} tokens</p>
              {session.web_searches > 0 && (
                <p className="text-xs text-gray-500">{session.web_searches} web search{session.web_searches === 1 ? '' : 'es'}</p>
              )}
              <p className="text-xs text-gray-400">${Number(session.cost_usd).toFixed(4)}</p>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-[#e5e3df]">
          <Link
            href="/research"
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M7.5 1.5L3 6l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            New research
          </Link>
        </div>
      </div>

      {/* Main output area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {isProcessing && (
          <div className="flex items-center gap-2 px-6 py-2 border-b border-[#e5e3df] bg-white flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#c8973f] animate-pulse" />
            <span className="text-xs text-gray-500">
              {streamStatus === 'searching'
                ? 'Searching the web for latest information…'
                : 'Claude is generating…'}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">

            {!output && !isProcessing && (
              <div className="flex flex-col items-center py-20 gap-4">
                <ClaudeAvatar size="lg" />
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
                <ClaudeAvatar />
                <div className="flex-1 min-w-0 pt-0.5">
                  {output ? (
                    <>
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

            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ClaudeAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const cls = size === 'lg'
    ? 'w-10 h-10 text-sm'
    : 'w-7 h-7 text-xs'
  return (
    <div className={`${cls} rounded-full bg-[#c8973f] flex-shrink-0 flex items-center justify-center text-white font-semibold`}>
      C
    </div>
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
