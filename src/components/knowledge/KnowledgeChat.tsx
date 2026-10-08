'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUp,
  BookOpen,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  MessageSquarePlus,
  PlayCircle,
  RotateCcw,
  Sparkles,
  ThumbsUp,
  Lightbulb,
  SearchX,
} from 'lucide-react'
import { useStickToBottom } from '@/lib/use-stick-to-bottom'
import { renderAnswerHtml } from '@/lib/knowledge/markdown'
import { ITEM_TYPE_LABELS, RATING_LABELS, RATING_ORDER } from '@/lib/knowledge/constants'
import { formatDayMonthYear } from '@/lib/date-format'
import FeedbackModal, { type FeedbackTarget } from '@/components/knowledge/FeedbackModal'
import type { KnowledgeItemType, KnowledgeMessage, KnowledgeRating, KnowledgeSource } from '@/types'

interface ChatSummary {
  id: string
  title: string
  updated_at: string
}

interface Props {
  chats: ChatSummary[]
  chatId: string | null
  initialMessages: KnowledgeMessage[]
  initialRatings: Record<string, KnowledgeRating>
  departments: { id: string; name: string }[]
}

type UiMessage = KnowledgeMessage & { streaming?: boolean }

const STARTERS = [
  'How should I structure an interview outline?',
  'Teach me how TRC approaches a first sales meeting',
  'Show me an example of excellent work',
  'What does the style guide say about quotes?',
]

const TYPE_ICONS: Record<KnowledgeItemType, React.ElementType> = {
  document: FileText,
  text: BookOpen,
  video: PlayCircle,
  link: Link2,
}

function SourceCard({ source }: { source: KnowledgeSource }) {
  const Icon = TYPE_ICONS[source.type]
  const external = source.type === 'video' || source.type === 'link'
  const openHref = external && source.url ? source.url : `/knowledge/items/${source.item_id}`
  return (
    <li className="rounded-lg border border-[#e5e3df] bg-white p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#f0efec] px-1.5 text-[10px] font-semibold text-[#6b6458]">
          {source.ref}
        </span>
        <div className="min-w-0 flex-1">
          <a
            href={openHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[13px] font-medium leading-snug text-gray-900 hover:underline"
          >
            {source.title}
          </a>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500">
            <Icon size={12} className="flex-shrink-0" />
            {ITEM_TYPE_LABELS[source.type]} · {source.department_name}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Guardian: {source.guardian_name ?? '—'}
            {source.last_updated ? ` · Updated ${formatDayMonthYear(source.last_updated)}` : ''}
          </p>
          {source.headings.length > 0 && (
            <p className="mt-1 truncate text-[11px] text-gray-400" title={source.headings.join(' · ')}>
              {source.headings.join(' · ')}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {source.is_example && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#fbf7ed] px-2 py-0.5 text-[10px] font-medium text-[#a07530]">
                <Sparkles size={10} /> Example of excellent work
              </span>
            )}
            {external && source.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 hover:text-black">
                <ExternalLink size={11} /> {source.type === 'video' ? 'Watch' : 'Open link'}
              </a>
            ) : source.type === 'document' ? (
              <a href={`/api/knowledge/items/${source.item_id}/download`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 hover:text-black">
                <Download size={11} /> Download
              </a>
            ) : (
              <a href={openHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 hover:text-black">
                <ExternalLink size={11} /> Open
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

function SourcesPanel({ sources }: { sources: KnowledgeSource[] }) {
  const cited = sources.filter((s) => s.cited)
  const related = sources.filter((s) => !s.cited)
  if (sources.length === 0) return null
  return (
    <aside className="flex flex-col gap-4">
      {cited.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Sources</p>
          <ul className="flex flex-col gap-2">{cited.map((s) => <SourceCard key={s.ref} source={s} />)}</ul>
        </div>
      )}
      {related.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Related</p>
          <ul className="flex flex-col gap-2">{related.map((s) => <SourceCard key={s.ref} source={s} />)}</ul>
        </div>
      )}
    </aside>
  )
}

export default function KnowledgeChat({ chats: initialChats, chatId: initialChatId, initialMessages, initialRatings, departments }: Props) {
  const [chats, setChats] = useState<ChatSummary[]>(initialChats)
  const [chatId, setChatId] = useState<string | null>(initialChatId)
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages)
  const [ratings, setRatings] = useState<Record<string, KnowledgeRating>>(initialRatings)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; retry?: string } | null>(null)
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastText = messages[messages.length - 1]?.content
  const { ref: scrollRef, onScroll, onWheel } = useStickToBottom<HTMLDivElement>(lastText)

  const hasDepartments = departments.length > 0

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setError(null)
    setBusy(true)
    setInput('')
    const now = new Date().toISOString()
    const tempUser: UiMessage = {
      id: `tmp-user-${Date.now()}`, chat_id: chatId ?? '', role: 'user', content: q, sources: [], used_version_ids: [],
      department_ids: [], no_answer: false, status: 'complete', tokens_total: 0, cost_usd: 0, created_at: now,
    }
    const tempAnswer: UiMessage = { ...tempUser, id: `tmp-answer-${Date.now()}`, role: 'assistant', content: '', streaming: true }
    setMessages((m) => [...m, tempUser, tempAnswer])

    const dropTemps = () => setMessages((m) => m.filter((x) => x.id !== tempUser.id && x.id !== tempAnswer.id))
    try {
      const res = await fetch('/api/knowledge/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message: q }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        dropTemps()
        setError({ text: data.error || 'The Knowledge Base couldn’t answer just now.', retry: res.status >= 500 ? q : undefined })
        if (res.status !== 402) setInput(q)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      while (!finished) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const evt of events) {
          const line = evt.trim()
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') {
            finished = true
            break
          }
          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(data)
          } catch {
            continue
          }
          if (payload.type === 'meta') {
            const id = payload.chatId as string
            if (!chatId) {
              setChatId(id)
              window.history.replaceState(null, '', `/knowledge/chat/${id}`)
              setChats((c) => [{ id, title: payload.title as string, updated_at: now }, ...c.filter((x) => x.id !== id)])
            } else {
              setChats((c) => {
                const cur = c.find((x) => x.id === id)
                return cur ? [{ ...cur, updated_at: now }, ...c.filter((x) => x.id !== id)] : c
              })
            }
          } else if (typeof payload.text === 'string') {
            const t = payload.text
            setMessages((m) => m.map((x) => (x.id === tempAnswer.id ? { ...x, content: x.content + t } : x)))
          } else if (payload.type === 'done' && payload.message) {
            const saved = payload.message as KnowledgeMessage
            setMessages((m) => m.map((x) => (x.id === tempAnswer.id ? { ...saved, streaming: false } : x)))
          } else if (typeof payload.error === 'string') {
            dropTemps()
            if (payload.chatDeleted) {
              setChatId(null)
              setChats((c) => c.filter((x) => x.id !== chatId))
              window.history.replaceState(null, '', '/knowledge')
            }
            setError({ text: payload.error, retry: q })
            finished = true
          }
        }
      }
      // Stream ended without a final message (connection dropped): the answer
      // is still saved server-side — reload the chat to pick it up.
      setMessages((m) => m.map((x) => (x.id === tempAnswer.id && x.streaming ? { ...x, streaming: false } : x)))
    } catch {
      dropTemps()
      setError({ text: 'Connection lost. Please try again.', retry: q })
    } finally {
      setBusy(false)
      textareaRef.current?.focus()
    }
  }

  async function rateHelpful(messageId: string) {
    setRatings((r) => ({ ...r, [messageId]: 'helpful' }))
    await fetch('/api/knowledge/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'feedback', rating: 'helpful', messageId }),
    }).catch(() => {})
  }

  function onRate(messageId: string, rating: KnowledgeRating) {
    if (rating === 'helpful') return void rateHelpful(messageId)
    setFeedbackTarget({ mode: 'rating', messageId, rating })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
      {/* History (US-112) */}
      <aside className="hidden lg:block">
        <Link
          href="/knowledge"
          className="flex items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-white hover:bg-gray-900"
        >
          <MessageSquarePlus size={14} /> New question
        </Link>
        <p className="mt-6 mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Your past chats</p>
        {chats.length === 0 ? (
          <p className="px-1 text-xs text-gray-400">No chats yet.</p>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
            {chats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/knowledge/chat/${c.id}`}
                  className={`block rounded-lg px-2.5 py-2 text-[13px] leading-snug transition-colors ${
                    c.id === chatId ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-600 hover:bg-white/70'
                  }`}
                >
                  <span className="line-clamp-2">{c.title}</span>
                  <span className="mt-0.5 block text-[10px] text-gray-400">{formatDayMonthYear(c.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="flex min-h-[70vh] flex-col rounded-xl border border-[#e5e3df] bg-white">
        <div ref={scrollRef} onScroll={onScroll} onWheel={onWheel} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 max-h-[70vh]">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-xl py-10 text-center">
              <BookOpen size={28} className="mx-auto text-gray-300" />
              <h2 className="mt-4 text-base font-semibold text-gray-900">What do you want to know about how TRC works?</h2>
              {hasDepartments ? (
                <>
                  <p className="mt-2 text-sm text-gray-500">
                    Answers come only from knowledge published in your departments
                    {departments.length <= 4 ? ` (${departments.map((d) => d.name).join(', ')})` : ''}, with sources you can open.
                  </p>
                  <div className="mt-6 grid gap-2 sm:grid-cols-2">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        onClick={() => ask(s)}
                        className="rounded-lg border border-[#e5e3df] px-3 py-2.5 text-left text-[13px] text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-500">
                  You haven’t been added to a department yet, so there’s no knowledge to search. Ask an admin to add you to your department.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-black px-4 py-2.5 text-sm text-white">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="min-w-0">
                      {m.no_answer && (
                        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                          <SearchX size={12} /> No approved answer
                        </p>
                      )}
                      {m.content ? (
                        <div className="prose-research text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: renderAnswerHtml(m.content) }} />
                      ) : (
                        <p className="inline-flex items-center gap-2 text-sm text-gray-400">
                          <Loader2 size={14} className="animate-spin" /> Searching TRC knowledge…
                        </p>
                      )}

                      {!m.streaming && !m.id.startsWith('tmp-') && (
                        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[#f0efec] pt-3">
                          {m.no_answer ? (
                            <button
                              onClick={() => setFeedbackTarget({ mode: 'rating', messageId: m.id, rating: 'missing' })}
                              disabled={ratings[m.id] === 'missing'}
                              className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e3df] px-3 py-1 text-[11px] font-medium text-gray-700 hover:border-gray-400 disabled:opacity-60"
                            >
                              {ratings[m.id] === 'missing' ? 'Sent to the Guardian' : 'Send to the Guardian as “Missing information”'}
                            </button>
                          ) : (
                            <>
                              {RATING_ORDER.map((r) => (
                                <button
                                  key={r}
                                  onClick={() => onRate(m.id, r)}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                                    ratings[m.id] === r
                                      ? 'border-black bg-black text-white'
                                      : 'border-[#e5e3df] text-gray-600 hover:border-gray-400'
                                  }`}
                                >
                                  {r === 'helpful' && <ThumbsUp size={11} />}
                                  {RATING_LABELS[r]}
                                </button>
                              ))}
                              <button
                                onClick={() => {
                                  const first = m.sources.find((s) => s.cited) ?? m.sources[0]
                                  setFeedbackTarget({ mode: 'suggest-change', messageId: m.id, itemTitle: first?.title, departmentId: first?.department_id })
                                }}
                                className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-black"
                              >
                                <Lightbulb size={12} /> Suggest a change
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <SourcesPanel sources={m.sources} />
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[#e5e3df] p-3 sm:p-4">
          {error && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <span>{error.text}</span>
              {error.retry && (
                <button onClick={() => ask(error.retry!)} className="inline-flex flex-shrink-0 items-center gap-1 font-medium hover:underline">
                  <RotateCcw size={12} /> Retry
                </button>
              )}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              ask(input)
            }}
            className="flex items-end gap-2"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask(input)
                }
              }}
              rows={1}
              maxLength={4000}
              disabled={!hasDepartments}
              placeholder={hasDepartments ? 'Ask how TRC does something…' : 'You need to be in a department to ask questions'}
              className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-[#e5e3df] px-4 py-3 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || !hasDepartments}
              className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-black text-white hover:bg-gray-900 disabled:opacity-40"
              aria-label="Ask"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </form>
          <p className="mt-2 text-[11px] text-gray-400">Answers use only published TRC knowledge — no web search. Check the sources for anything important.</p>
        </div>
      </section>

      <FeedbackModal
        target={feedbackTarget}
        departments={departments}
        onClose={() => setFeedbackTarget(null)}
        onSubmitted={(t) => {
          if (t.mode === 'rating') setRatings((r) => ({ ...r, [t.messageId]: t.rating }))
        }}
      />
    </div>
  )
}
