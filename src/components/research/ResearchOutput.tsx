'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ChatInterface from './ChatInterface'
import type { ResearchSession, Message } from '@/types'

interface Props {
  session: ResearchSession
  messages: Message[]
  isGenerating: boolean
}

export default function ResearchOutput({ session, messages: initialMessages, isGenerating }: Props) {
  const [output, setOutput] = useState(session.initial_output || '')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const hasStartedRef = useRef(false)

  useEffect(() => {
    if (isGenerating && !session.initial_output && !hasStartedRef.current) {
      hasStartedRef.current = true
      startGeneration()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  async function startGeneration() {
    setIsStreaming(true)
    setError(null)
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
        setIsStreaming(false)
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
          const data = line.slice(6).trim()
          if (data === '[DONE]') break
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) {
              setError(parsed.error)
              break
            }
            if (parsed.text) {
              accumulated += parsed.text
              setOutput(accumulated)
            }
          } catch {}
        }
      }

      // Strip ?generating=true from the URL now that streaming is done
      router.replace(`/research/${session.id}`)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* Left info panel */}
      <div className="w-72 bg-white border-r border-[#e5e3df] flex-shrink-0 overflow-y-auto">
        <div className="p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">{session.full_name}</h2>
          <div className="space-y-3">
            <InfoRow label="Type" value={session.category_name} />
            <InfoRow label="Title" value={session.title_position} />
            <InfoRow label="Organisation" value={session.company_org} />
            <InfoRow label="Country" value={session.country_focus} />
            <InfoRow label="Publication" value={session.publication} />
            <InfoRow label="Partner Country" value={session.media_partner_country} />
          </div>

          {session.tokens_total > 0 && (
            <div className="mt-6 pt-6 border-t border-[#e5e3df]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Usage
              </p>
              <p className="text-xs text-gray-500">{formatTokens(session.tokens_total)} tokens</p>
              <p className="text-xs text-gray-400">${Number(session.cost_usd).toFixed(4)}</p>
            </div>
          )}

          <div className="mt-6">
            <Link href="/research" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
              ← New interview
            </Link>
          </div>
        </div>
      </div>

      {/* Right panel: output + chat */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#e5e3df] bg-[#f0efec] flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900">Interview Research &amp; Questions</h3>
          {isStreaming && (
            <p className="text-xs text-gray-400 mt-0.5">Claude is generating research...</p>
          )}
        </div>

        {/* Output area */}
        <div ref={outputRef} className="flex-1 overflow-y-auto px-6 py-5 bg-[#f0efec]">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 flex items-start justify-between gap-3">
              <p className="text-xs text-red-700">{error}</p>
              <button
                onClick={() => {
                  setError(null)
                  startGeneration()
                }}
                className="text-xs text-red-600 font-medium whitespace-nowrap hover:text-red-800 transition-colors flex-shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {!output && !isStreaming && !error && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-xs text-gray-400 italic">No output generated yet.</p>
              <button
                onClick={() => startGeneration()}
                className="text-xs font-medium bg-black text-white px-4 py-2 hover:bg-gray-900 transition-colors"
              >
                Generate Research
              </button>
            </div>
          )}

          {!output && isStreaming && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="cursor-blink">▋</span>
              <span>Researching interviewee...</span>
            </div>
          )}

          {output && (
            <div className="max-w-3xl">
              <div
                className="research-output text-sm text-gray-800"
                dangerouslySetInnerHTML={{ __html: formatOutput(output) }}
              />
              {isStreaming && <span className="cursor-blink text-gray-400">▋</span>}
            </div>
          )}
        </div>

        {/* Chat */}
        {output && !isStreaming && (
          <ChatInterface sessionId={session.id} initialMessages={initialMessages} />
        )}
      </div>
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

function formatOutput(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n\n/g, '</p><p class="mb-3">')
    .replace(/\n/g, '<br>')
}
