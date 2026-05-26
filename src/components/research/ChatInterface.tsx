'use client'

import { useState, useRef, useEffect } from 'react'
import type { Message } from '@/types'

interface Props {
  sessionId: string
  initialMessages: Message[]
}

export default function ChatInterface({ sessionId, initialMessages }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setError(null)

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      session_id: sessionId,
      role: 'user',
      content: userMessage,
      tokens_input: 0,
      tokens_output: 0,
      cost_usd: 0,
      created_at: new Date().toISOString(),
    }
    const tempAssistantMsg: Message = {
      id: `temp-assistant-${Date.now()}`,
      session_id: sessionId,
      role: 'assistant',
      content: '',
      tokens_input: 0,
      tokens_output: 0,
      cost_usd: 0,
      created_at: new Date().toISOString(),
    }

    setMessages(prev => [...prev, tempUserMsg, tempAssistantMsg])
    setLoading(true)

    try {
      const res = await fetch(`/api/research/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMessage }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to send message.')
        setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')))
        setLoading(false)
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
              setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')))
              return
            }
            if (parsed.text) {
              accumulated += parsed.text
              setMessages(prev =>
                prev.map(m =>
                  m.id === tempAssistantMsg.id ? { ...m, content: accumulated } : m
                )
              )
            }
          } catch {}
        }
      }
    } catch {
      setError('Network error. Please try again.')
      setMessages(prev => prev.filter(m => !m.id.startsWith('temp-')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col border-t border-[#e5e3df] bg-white flex-shrink-0" style={{ maxHeight: '45%' }}>
      {/* Messages */}
      {messages.length > 0 && (
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-black text-white'
                    : 'bg-[#f0efec] text-gray-800'
                }`}
              >
                {msg.content || (
                  <span className="cursor-blink text-gray-400">▋</span>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-5 py-2 bg-red-50 border-t border-red-100">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="flex items-center gap-3 px-5 py-3 border-t border-[#e5e3df]">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Refine research or questions..."
          disabled={loading}
          className="flex-1 text-sm bg-transparent border-b border-gray-200 py-1.5 placeholder:text-gray-400 focus:outline-none focus:border-black transition-colors"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex-shrink-0 bg-black text-white px-4 py-1.5 text-xs font-medium tracking-wider uppercase hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? '...' : 'Send'}
        </button>
      </form>
    </div>
  )
}
