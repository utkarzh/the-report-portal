'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, ExternalLink, FilePlus2, Inbox, Lightbulb, MessageSquareWarning, Paperclip, RotateCcw, X } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import { Avatar } from '@/components/knowledge/kb-ui'
import { FEEDBACK_STATUS_LABELS, RATING_LABELS, stripCitations } from '@/lib/knowledge/constants'
import { formatDayMonthYear } from '@/lib/date-format'
import type { KnowledgeFeedback } from '@/types'

export interface ReviewEntry extends KnowledgeFeedback {
  sender_name: string | null
  item_title: string | null
  question: string | null
  answer: string | null
}

const TONE = { open: 'amber', accepted: 'emerald', declined: 'stone', done: 'sky' } as const

function describe(e: ReviewEntry): { icon: React.ElementType; text: string; accent: string } {
  if (e.kind === 'suggestion') {
    return e.suggestion_type === 'new'
      ? { icon: FilePlus2, text: 'suggested new knowledge', accent: 'bg-[#c8973f]' }
      : { icon: Lightbulb, text: 'suggested a change', accent: 'bg-sky-400' }
  }
  const label = e.rating ? RATING_LABELS[e.rating] : 'Feedback'
  return { icon: MessageSquareWarning, text: `marked an answer “${label}”`, accent: e.rating === 'incorrect' ? 'bg-red-400' : 'bg-amber-400' }
}

// US-117: the Guardian's queue — what was sent, the original answer, the
// source item and who sent it — with Accept (opens the item as a draft),
// Decline (optional note) and Mark done.
export default function ReviewQueue({ entries, canEdit, basePath }: { entries: ReviewEntry[]; canEdit: boolean; basePath: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [declining, setDeclining] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function act(id: string, action: string, extra?: { note?: string }) {
    setBusy(id)
    setError(null)
    const res = await fetch(`/api/knowledge/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return
    }
    setDeclining(null)
    setNote('')
    if (action === 'accept' && data.redirect) router.push(data.redirect)
    else router.refresh()
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#d9d5cc] bg-white/60 px-6 py-14 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#eceae5] bg-white text-emerald-600 shadow-sm">
          <Inbox size={19} strokeWidth={1.75} />
        </span>
        <p className="mt-4 text-sm font-semibold text-gray-900">All caught up</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-gray-500">
          When a colleague flags an answer or suggests a change for this department, it lands here for review.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{error}</p>}
      {entries.map((e) => {
        const d = describe(e)
        const Icon = d.icon
        return (
          <article key={e.id} className="relative overflow-hidden rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
            <span className={`absolute inset-y-0 left-0 w-1 ${e.status === 'open' ? d.accent : 'bg-[#e5e3df]'}`} />
            <div className="p-5 pl-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar name={e.sender_name ?? 'Deleted user'} size="md" />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700">
                      <span className="font-semibold text-gray-900">{e.sender_name ?? 'A deleted user'}</span> {d.text}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-gray-500">
                      <Icon size={11} className="text-gray-400" />
                      {formatDayMonthYear(e.created_at)}
                      {e.item_title && e.item_id && (
                        <>
                          <span className="text-gray-300">·</span> Source
                          <Link href={`${basePath}/items/${e.item_id}`} className="font-medium text-gray-700 hover:underline">
                            {e.item_title}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <StatusPill label={FEEDBACK_STATUS_LABELS[e.status]} tone={TONE[e.status]} />
              </div>

              {e.comment ? (
                <blockquote className="mt-3.5 whitespace-pre-wrap rounded-xl bg-[#faf9f7] px-4 py-3 text-sm leading-6 text-gray-800">{e.comment}</blockquote>
              ) : (
                <p className="mt-3 text-xs italic text-gray-400">No comment added.</p>
              )}
              {(e.link_url || e.attachment_path) && (
                <div className="mt-2.5 flex flex-wrap gap-2 text-xs">
                  {e.link_url && (
                    <a href={e.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#e5e3df] px-2.5 py-1 text-gray-600 hover:border-gray-400 hover:text-black">
                      <ExternalLink size={12} /> <span className="truncate">{e.link_url.length > 60 ? `${e.link_url.slice(0, 57)}…` : e.link_url}</span>
                    </a>
                  )}
                  {e.attachment_path && (
                    <a href={`/api/knowledge/feedback/${e.id}/attachment`} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] px-2.5 py-1 text-gray-600 hover:border-gray-400 hover:text-black">
                      <Paperclip size={12} /> {e.attachment_name}
                    </a>
                  )}
                </div>
              )}

              {(e.question || e.answer) && (
                <details className="group mt-3 rounded-xl border border-[#eceae5]">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-gray-600 hover:text-gray-900">
                    <ChevronRight size={12} className="transition-transform group-open:rotate-90" /> The question and the answer they saw
                  </summary>
                  <div className="border-t border-[#eceae5] px-4 py-3">
                    {e.question && (
                      <p className="text-xs leading-5 text-gray-900">
                        <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded bg-black text-[9px] font-semibold text-white">Q</span>
                        {e.question}
                      </p>
                    )}
                    {e.answer && (
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-gray-600">
                        <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded bg-[#ebe8e2] text-[9px] font-semibold text-gray-600">A</span>
                        {stripCitations(e.answer).slice(0, 1500)}
                        {e.answer.length > 1500 ? '…' : ''}
                      </p>
                    )}
                  </div>
                </details>
              )}

              {e.guardian_note && (
                <p className="mt-3 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">Your reply:</span> {e.guardian_note}
                </p>
              )}

              {canEdit && (
                <div className="mt-4 border-t border-[#f0efec] pt-3.5">
                  {declining === e.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={note}
                        onChange={(ev) => setNote(ev.target.value)}
                        rows={2}
                        autoFocus
                        placeholder="Optional reply for the sender — e.g. why it isn’t changing"
                        className="w-full rounded-xl border border-[#e5e3df] p-3 text-sm focus:border-black focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => act(e.id, 'decline', { note })}
                          disabled={busy === e.id}
                          className="rounded-lg bg-black px-3.5 py-1.5 text-xs font-medium text-white hover:bg-gray-900 disabled:opacity-50"
                        >
                          Decline
                        </button>
                        <button type="button" onClick={() => setDeclining(null)} className="rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : e.status === 'open' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => act(e.id, 'accept')}
                        disabled={busy === e.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3.5 py-1.5 text-xs font-medium text-white hover:bg-gray-900 disabled:opacity-50"
                      >
                        <Check size={12} /> Accept &amp; edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeclining(e.id)
                          setNote('')
                        }}
                        disabled={busy === e.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] px-3.5 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400"
                      >
                        <X size={12} /> Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => act(e.id, 'done')}
                        disabled={busy === e.id}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-[#f7f6f3] hover:text-gray-900"
                      >
                        Mark done
                      </button>
                      <span className="ml-auto hidden text-[11px] text-gray-400 sm:inline">
                        {e.item_id ? 'Accept opens the source as a draft' : 'Accept starts a new guide'}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => act(e.id, 'reopen')}
                      disabled={busy === e.id}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-black"
                    >
                      <RotateCcw size={11} /> Reopen
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
