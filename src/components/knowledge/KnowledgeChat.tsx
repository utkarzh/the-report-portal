'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  History,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquare,
  Plus,
  Quote,
  RotateCcw,
  Search,
  SearchX,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Handshake,
} from 'lucide-react'
import { useStickToBottom } from '@/lib/use-stick-to-bottom'
import { renderAnswerHtml } from '@/lib/knowledge/markdown'
import { ITEM_TYPE_LABELS, RATING_LABELS, stripCitations } from '@/lib/knowledge/constants'
import { chatGroupLabel, plural } from '@/lib/knowledge/format'
import { formatDayMonthYear } from '@/lib/date-format'
import FeedbackModal, { type FeedbackTarget } from '@/components/knowledge/FeedbackModal'
import { TypeTile } from '@/components/knowledge/kb-ui'
import type { KnowledgeItemType, KnowledgeMessage, KnowledgeRating, KnowledgeSource } from '@/types'

interface ChatSummary {
  id: string
  title: string
  updated_at: string
}

export interface RecentItem {
  id: string
  title: string
  type: KnowledgeItemType
  department_name: string
  last_published_at: string | null
  is_example: boolean
}

interface Props {
  chats: ChatSummary[]
  chatId: string | null
  initialMessages: KnowledgeMessage[]
  initialRatings: Record<string, KnowledgeRating>
  departments: { id: string; name: string }[]
  recent: RecentItem[]
  // Server render time — the history groups (Today, Yesterday…) are computed
  // against it so server render and hydration agree.
  nowIso: string
  initialQuestion?: string
  // The admin tools strip sits above the chat; the workspace is shorter to fit.
  withAdminBar?: boolean
}

type UiMessage = KnowledgeMessage & { streaming?: boolean }

const STARTERS: { icon: React.ElementType; text: string }[] = [
  { icon: ListChecks, text: 'How should I structure an interview outline?' },
  { icon: Handshake, text: 'Teach me how TRC approaches a first sales meeting' },
  { icon: Sparkles, text: 'Show me an example of excellent work' },
  { icon: Quote, text: 'What does the style guide say about quotes?' },
]

const PROBLEM_RATINGS: KnowledgeRating[] = ['unclear', 'incorrect', 'outdated', 'missing']
const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older']

function SourceCard({ source, anchorId, highlighted }: { source: KnowledgeSource; anchorId: string; highlighted: boolean }) {
  const external = (source.type === 'video' || source.type === 'link') && !!source.url
  const openHref = external ? source.url! : `/knowledge/items/${source.item_id}`
  return (
    <li
      id={anchorId}
      className={`relative flex gap-3 rounded-xl border bg-white p-3 transition-all duration-300 ${
        highlighted ? 'border-[#c8973f] shadow-md ring-4 ring-[#c8973f]/15' : 'border-[#e5e3df] hover:border-gray-300'
      }`}
    >
      <span className="absolute -left-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1.5 text-[10px] font-semibold text-white ring-2 ring-white">
        {source.ref}
      </span>
      <TypeTile type={source.type} size="sm" example={source.is_example} />
      <div className="min-w-0 flex-1">
        <a
          href={openHref}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-[13px] font-medium leading-snug text-gray-900 hover:underline"
        >
          {source.title}
        </a>
        <p className="mt-0.5 truncate text-[11px] text-gray-500">
          {ITEM_TYPE_LABELS[source.type]} · {source.department_name}
          {source.topic_name ? ` · ${source.topic_name}` : ''}
        </p>
        {source.headings.length > 0 && (
          <p className="mt-1 truncate text-[11px] text-gray-400" title={source.headings.join(' · ')}>
            § {source.headings.join(' · ')}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#f0efec] pt-2 text-[11px]">
          <span className="text-gray-500">
            Guardian <span className="text-gray-700">{source.guardian_name ?? '—'}</span>
          </span>
          {source.last_updated && <span className="text-gray-400">Updated {formatDayMonthYear(source.last_updated)}</span>}
          {source.is_example && (
            <span className="inline-flex items-center gap-1 font-medium text-[#a07530]">
              <Sparkles size={10} /> Example
            </span>
          )}
          <span className="ml-auto flex items-center gap-3">
            {source.type === 'document' && (
              <a href={`/api/knowledge/items/${source.item_id}/download`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-black">
                <Download size={11} /> Download
              </a>
            )}
            <a href={openHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-black">
              <ExternalLink size={11} /> {source.type === 'video' && external ? 'Watch' : 'Open'}
            </a>
          </span>
        </div>
      </div>
    </li>
  )
}

function SourcesBlock({ messageId, sources, highlightRef }: { messageId: string; sources: KnowledgeSource[]; highlightRef: number | null }) {
  const cited = sources.filter((s) => s.cited)
  const related = sources.filter((s) => !s.cited)
  if (sources.length === 0) return null
  return (
    <div className="mt-5">
      {cited.length > 0 && (
        <>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Sources <span className="font-medium text-gray-300">{cited.length}</span>
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {cited.map((s) => (
              <SourceCard key={s.ref} source={s} anchorId={`src-${messageId}-${s.ref}`} highlighted={highlightRef === s.ref} />
            ))}
          </ul>
        </>
      )}
      {related.length > 0 && (
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-900">
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
            {plural(related.length, 'related item')} also matched
          </summary>
          <ul className="mt-2.5 grid gap-3 sm:grid-cols-2">
            {related.map((s) => (
              <SourceCard key={s.ref} source={s} anchorId={`src-${messageId}-${s.ref}`} highlighted={highlightRef === s.ref} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export default function KnowledgeChat({
  chats: initialChats,
  chatId: initialChatId,
  initialMessages,
  initialRatings,
  departments,
  recent,
  nowIso,
  initialQuestion,
  withAdminBar = false,
}: Props) {
  const [chats, setChats] = useState<ChatSummary[]>(initialChats)
  const [chatId, setChatId] = useState<string | null>(initialChatId)
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages)
  const [ratings, setRatings] = useState<Record<string, KnowledgeRating>>(initialRatings)
  const [input, setInput] = useState(initialQuestion ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; retry?: string } | null>(null)
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget | null>(null)
  const [problemFor, setProblemFor] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<{ messageId: string; ref: number } | null>(null)
  const [historyFilter, setHistoryFilter] = useState('')
  const [mobileHistory, setMobileHistory] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastText = messages[messages.length - 1]?.content
  const { ref: scrollRef, onScroll, onWheel } = useStickToBottom<HTMLDivElement>(`${messages.length}:${lastText ?? ''}`)

  const hasDepartments = departments.length > 0
  const currentTitle = chatId ? chats.find((c) => c.id === chatId)?.title ?? null : null
  const questionCount = messages.filter((m) => m.role === 'user').length

  // Grow the question box with its content (up to ~8 lines).
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`
  }, [input])

  useEffect(() => {
    if (initialQuestion) textareaRef.current?.focus()
  }, [initialQuestion])

  useEffect(() => {
    if (!highlight) return
    const t = setTimeout(() => setHighlight(null), 1800)
    return () => clearTimeout(t)
  }, [highlight])

  const groups = useMemo(() => {
    const q = historyFilter.trim().toLowerCase()
    const map = new Map<string, ChatSummary[]>()
    for (const c of chats) {
      if (q && !c.title.toLowerCase().includes(q)) continue
      const label = chatGroupLabel(c.updated_at, nowIso)
      map.set(label, [...(map.get(label) ?? []), c])
    }
    return GROUP_ORDER.filter((l) => map.has(l)).map((label) => ({ label, chats: map.get(label)! }))
  }, [chats, historyFilter, nowIso])

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
    setProblemFor(null)
    await fetch('/api/knowledge/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'feedback', rating: 'helpful', messageId }),
    }).catch(() => {})
  }

  async function copyAnswer(m: UiMessage) {
    try {
      await navigator.clipboard.writeText(stripCitations(m.content).trim())
      setCopiedId(m.id)
      setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 2000)
    } catch {
      // Clipboard blocked (insecure context / permissions) — nothing to do.
    }
  }

  // Clicking a citation chip (¹) scrolls to, and briefly highlights, its source card.
  function onAnswerClick(e: React.MouseEvent, messageId: string) {
    const chip = (e.target as HTMLElement).closest('.kb-cite') as HTMLElement | null
    if (!chip) return
    const ref = Number(chip.dataset.ref)
    if (!ref) return
    setHighlight({ messageId, ref })
    const card = document.getElementById(`src-${messageId}-${ref}`)
    const details = card?.closest('details')
    if (details && !details.open) details.open = true
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const heightClass = withAdminBar ? 'lg:h-[calc(100dvh-20rem)]' : 'lg:h-[calc(100dvh-14.5rem)]'

  const historyList = (
    <>
      {groups.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-gray-400">
          {historyFilter ? 'No chats match.' : 'Your questions will appear here.'}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.label} className="mb-2">
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{g.label}</p>
            <ul className="flex flex-col gap-0.5">
              {g.chats.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/knowledge/chat/${c.id}`}
                    onClick={() => setMobileHistory(false)}
                    className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-[13px] leading-snug transition-colors ${
                      c.id === chatId ? 'bg-[#f3f1ec] font-medium text-gray-900' : 'text-gray-600 hover:bg-[#faf9f7] hover:text-gray-900'
                    }`}
                  >
                    <MessageSquare size={13} className={`mt-0.5 flex-shrink-0 ${c.id === chatId ? 'text-[#a07530]' : 'text-gray-300'}`} />
                    <span className="line-clamp-2">{c.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </>
  )

  return (
    <div className={`grid gap-5 lg:min-h-[560px] lg:grid-cols-[268px_minmax(0,1fr)] ${heightClass}`}>
      {/* History (US-112) */}
      <aside className="hidden min-h-0 flex-col rounded-2xl border border-[#e5e3df] bg-white shadow-sm lg:flex">
        <div className="border-b border-[#eceae5] p-3">
          <Link
            href="/knowledge"
            className="flex items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900"
          >
            <Plus size={15} /> New question
          </Link>
          {chats.length > 5 && (
            <div className="relative mt-2.5">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
                placeholder="Search your chats"
                className="w-full rounded-lg border border-[#e5e3df] bg-[#faf9f7] py-2 pl-8 pr-3 text-xs placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none"
              />
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{historyList}</div>
        <div className="border-t border-[#eceae5] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Answers draw on</p>
          {hasDepartments ? (
            <p className="mt-1.5 text-xs leading-5 text-gray-600">
              {departments.slice(0, 6).map((d) => d.name).join(' · ')}
              {departments.length > 6 ? ` +${departments.length - 6} more` : ''}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-amber-700">No departments yet</p>
          )}
        </div>
      </aside>

      <section className="relative flex h-[calc(100dvh-11rem)] min-h-[520px] flex-col rounded-2xl border border-[#e5e3df] bg-white shadow-sm lg:h-auto lg:min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-[#eceae5] px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">{currentTitle ?? 'New question'}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
              <ShieldCheck size={11} className="flex-shrink-0 text-emerald-600" />
              <span className="truncate">
                {questionCount > 0 ? `${plural(questionCount, 'question')} · ` : ''}Answers from approved, published TRC knowledge only
              </span>
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileHistory((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] px-2.5 py-1.5 text-xs font-medium text-gray-700"
            >
              <History size={13} /> History <ChevronDown size={12} className={mobileHistory ? 'rotate-180' : ''} />
            </button>
            <Link href="/knowledge" className="inline-flex items-center gap-1 rounded-lg bg-black px-2.5 py-1.5 text-xs font-medium text-white">
              <Plus size={13} /> New
            </Link>
          </div>
        </div>
        {mobileHistory && (
          <div className="absolute inset-x-3 top-[3.75rem] z-20 max-h-[60%] overflow-y-auto rounded-xl border border-[#e5e3df] bg-white p-2 shadow-xl lg:hidden">
            {historyList}
          </div>
        )}

        {/* The stick-to-bottom ref only attaches once there's a conversation, so
            the empty state opens at the top instead of pinned to the bottom. */}
        <div
          ref={messages.length ? scrollRef : undefined}
          onScroll={onScroll}
          onWheel={onWheel}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"
        >
          {messages.length === 0 ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center py-4 text-center sm:py-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fbf7ed] text-[#a07530]">
                <Sparkles size={22} />
              </div>
              <h2 className="mt-4 text-lg font-semibold tracking-tight text-gray-900">What would you like to know about how TRC works?</h2>
              {hasDepartments ? (
                <>
                  <p className="mt-1.5 max-w-lg text-sm leading-6 text-gray-500">
                    Ask in plain language. Answers come only from knowledge your department Guardians have approved and published — and every answer shows its sources.
                  </p>
                  <div className="mt-6 grid w-full gap-2.5 sm:grid-cols-2">
                    {STARTERS.map(({ icon: Icon, text }) => (
                      <button
                        key={text}
                        type="button"
                        onClick={() => ask(text)}
                        disabled={busy}
                        className="group flex items-start gap-3 rounded-xl border border-[#e5e3df] bg-white p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-[#c8973f]/40 hover:shadow-sm disabled:opacity-50"
                      >
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#f7f6f3] text-gray-500 transition-colors group-hover:bg-[#fbf7ed] group-hover:text-[#a07530]">
                          <Icon size={14} />
                        </span>
                        <span className="pt-1 text-[13px] leading-snug text-gray-700 group-hover:text-gray-900">{text}</span>
                      </button>
                    ))}
                  </div>

                  {recent.length > 0 && (
                    <div className="mt-8 w-full text-left">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Recently updated in your departments</p>
                        <Link href="/knowledge/browse" className="text-[11px] font-medium text-gray-500 hover:text-black">
                          Browse all →
                        </Link>
                      </div>
                      <ul className="divide-y divide-[#f0efec] overflow-hidden rounded-xl border border-[#e5e3df]">
                        {recent.map((r) => (
                          <li key={r.id}>
                            <Link href={`/knowledge/items/${r.id}`} className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-[#faf9f7]">
                              <TypeTile type={r.type} size="sm" example={r.is_example} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-gray-900">{r.title}</span>
                                <span className="block truncate text-[11px] text-gray-500">
                                  {ITEM_TYPE_LABELS[r.type]} · {r.department_name}
                                </span>
                              </span>
                              {r.last_published_at && (
                                <span className="hidden flex-shrink-0 text-[11px] text-gray-400 sm:block">{formatDayMonthYear(r.last_published_at)}</span>
                              )}
                              <ChevronRight size={14} className="flex-shrink-0 text-gray-300 group-hover:text-gray-500" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-3">
                    {[
                      { icon: ShieldCheck, title: 'Approved sources only', body: 'Drafts, personal files and the open web are never used.' },
                      { icon: BookOpen, title: 'Every claim is cited', body: 'Click a number in an answer to jump to its source.' },
                      { icon: Lightbulb, title: 'Spotted a gap?', body: 'Flag it — the department’s Guardian reviews every report.' },
                    ].map(({ icon: Icon, title, body }) => (
                      <div key={title} className="rounded-xl bg-[#faf9f7] p-3.5">
                        <Icon size={15} className="text-[#a07530]" />
                        <p className="mt-2 text-xs font-semibold text-gray-800">{title}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-gray-500">{body}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="mt-5 max-w-md rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 text-left">
                  <p className="text-sm font-medium text-amber-900">You haven’t been added to a department yet</p>
                  <p className="mt-1 text-xs leading-5 text-amber-800/80">
                    The Knowledge Base only answers from the departments you belong to, so there’s nothing to search yet. Ask an admin to add you to your department.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-8">
              {messages.map((m) => {
                if (m.role === 'user') {
                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#151515] px-4 py-2.5 text-sm leading-6 text-white shadow-sm">
                        {m.content}
                      </div>
                    </div>
                  )
                }
                const citedCount = m.sources.filter((s) => s.cited).length
                const settled = !m.streaming && !m.id.startsWith('tmp-')
                const rating = ratings[m.id]
                const reported = rating && rating !== 'helpful'
                return (
                  <article key={m.id} className="flex gap-3">
                    <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-black text-white">
                      <BookOpen size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-gray-900">Knowledge Base</span>
                        {m.streaming ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
                            <Loader2 size={11} className="animate-spin text-[#a07530]" /> Writing…
                          </span>
                        ) : m.no_answer ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            <SearchX size={10} /> No approved answer
                          </span>
                        ) : citedCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            <ShieldCheck size={10} /> Based on {plural(citedCount, 'approved source')}
                          </span>
                        ) : null}
                      </div>

                      {m.content ? (
                        <div
                          onClick={(e) => onAnswerClick(e, m.id)}
                          className="prose-research text-sm leading-7 text-gray-800"
                          dangerouslySetInnerHTML={{ __html: renderAnswerHtml(m.content) }}
                        />
                      ) : (
                        <div className="space-y-2.5 pt-1">
                          <p className="inline-flex items-center gap-2 text-[13px] text-gray-500">
                            <Loader2 size={13} className="animate-spin text-[#a07530]" /> Searching approved TRC knowledge…
                          </p>
                          <div className="h-2.5 w-11/12 animate-pulse rounded bg-[#f0efec]" />
                          <div className="h-2.5 w-4/5 animate-pulse rounded bg-[#f0efec]" />
                          <div className="h-2.5 w-2/3 animate-pulse rounded bg-[#f0efec]" />
                        </div>
                      )}

                      {settled && m.no_answer && (
                        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                          <p className="text-[13px] font-medium text-amber-900">Nothing published in your departments answers this yet</p>
                          <p className="mt-1 text-xs leading-5 text-amber-800/80">
                            Rather than guess, the Knowledge Base only answers from approved material. Tell the Guardian what’s missing so they can add it.
                          </p>
                          <button
                            type="button"
                            onClick={() => setFeedbackTarget({ mode: 'rating', messageId: m.id, rating: 'missing' })}
                            disabled={rating === 'missing'}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-900 disabled:bg-amber-100 disabled:text-amber-800"
                          >
                            {rating === 'missing' ? (
                              <>
                                <Check size={12} /> Sent to the Guardian
                              </>
                            ) : (
                              <>
                                <Lightbulb size={12} /> Send this gap to the Guardian
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      <SourcesBlock messageId={m.id} sources={m.sources} highlightRef={highlight?.messageId === m.id ? highlight.ref : null} />

                      {settled && !m.no_answer && (
                        <div className="mt-5 border-t border-[#f0efec] pt-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="mr-1 text-[11px] text-gray-400">Was this helpful?</span>
                            <button
                              type="button"
                              onClick={() => rateHelpful(m.id)}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                rating === 'helpful' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-[#e5e3df] text-gray-600 hover:border-gray-300 hover:text-gray-900'
                              }`}
                            >
                              <ThumbsUp size={12} /> {rating === 'helpful' ? 'Helpful' : 'Yes'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setProblemFor((id) => (id === m.id ? null : m.id))}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                reported || problemFor === m.id ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-[#e5e3df] text-gray-600 hover:border-gray-300 hover:text-gray-900'
                              }`}
                            >
                              <ThumbsDown size={12} /> {reported ? RATING_LABELS[rating] : 'No'}
                            </button>
                            <span className="ml-auto flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => copyAnswer(m)}
                                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900"
                              >
                                {copiedId === m.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                                {copiedId === m.id ? 'Copied' : 'Copy'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const first = m.sources.find((s) => s.cited) ?? m.sources[0]
                                  setFeedbackTarget({ mode: 'suggest-change', messageId: m.id, itemTitle: first?.title, departmentId: first?.department_id })
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900"
                              >
                                <Lightbulb size={12} /> Suggest a change
                              </button>
                            </span>
                          </div>
                          {problemFor === m.id && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-xl bg-[#faf9f7] px-3 py-2.5">
                              <span className="mr-1 text-[11px] text-gray-500">What was wrong?</span>
                              {PROBLEM_RATINGS.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => {
                                    setProblemFor(null)
                                    setFeedbackTarget({ mode: 'rating', messageId: m.id, rating: r })
                                  }}
                                  className="rounded-full border border-[#e5e3df] bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:border-gray-400"
                                >
                                  {RATING_LABELS[r]}
                                </button>
                              ))}
                            </div>
                          )}
                          {reported && (
                            <p className="mt-2 text-[11px] text-gray-500">
                              Sent to the Guardian as “{RATING_LABELS[rating]}”. Follow it under{' '}
                              <Link href="/knowledge/suggestions" className="font-medium text-gray-700 underline-offset-2 hover:underline">
                                My suggestions
                              </Link>
                              .
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-b-2xl border-t border-[#eceae5] bg-[#fcfbf9] px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
          {error && (
            <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              <span>{error.text}</span>
              {error.retry && (
                <button type="button" onClick={() => ask(error.retry!)} className="inline-flex flex-shrink-0 items-center gap-1 font-medium hover:underline">
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
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-[#e5e3df] bg-white p-1.5 pl-4 shadow-sm transition-colors focus-within:border-gray-900"
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
              className="max-h-48 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm leading-6 placeholder:text-gray-400 focus:outline-none disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || !hasDepartments}
              className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-black text-white transition-colors hover:bg-gray-900 disabled:bg-gray-200 disabled:text-gray-400"
              aria-label="Ask"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </form>
          <p className="mx-auto mt-2 max-w-3xl px-1 text-[11px] text-gray-400">
            <span className="hidden sm:inline">Enter to send · Shift + Enter for a new line · </span>
            No web search — check the sources for anything important.
            {input.length > 3500 && <span className="ml-1 text-amber-700">{(4000 - input.length).toLocaleString('en-US')} characters left</span>}
          </p>
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
