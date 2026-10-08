'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, Paperclip, X, CornerDownRight, RotateCcw } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
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
      <div className="rounded-xl border border-dashed border-[#e5e3df] bg-white p-10 text-center text-sm text-gray-500">
        Nothing here. Feedback and suggestions for this department will appear in this queue.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {entries.map((e) => (
        <article key={e.id} className="rounded-xl border border-[#e5e3df] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                {e.kind === 'suggestion'
                  ? e.suggestion_type === 'new'
                    ? 'Suggestion · new knowledge'
                    : 'Suggestion · change'
                  : `Feedback · ${e.rating ? RATING_LABELS[e.rating] : ''}`}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                From {e.sender_name ?? 'a deleted user'} · {formatDayMonthYear(e.created_at)}
                {e.item_title && e.item_id && (
                  <>
                    {' · Source: '}
                    <Link href={`${basePath}/items/${e.item_id}`} className="font-medium text-gray-700 hover:underline">{e.item_title}</Link>
                  </>
                )}
              </p>
            </div>
            <StatusPill label={FEEDBACK_STATUS_LABELS[e.status]} tone={TONE[e.status]} />
          </div>

          {e.comment && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-800">{e.comment}</p>}
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            {e.link_url && (
              <a href={e.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gray-600 hover:text-black">
                <ExternalLink size={12} /> {e.link_url.length > 60 ? `${e.link_url.slice(0, 57)}…` : e.link_url}
              </a>
            )}
            {e.attachment_path && (
              <a href={`/api/knowledge/feedback/${e.id}/attachment`} className="inline-flex items-center gap-1 text-gray-600 hover:text-black">
                <Paperclip size={12} /> {e.attachment_name}
              </a>
            )}
          </div>

          {(e.question || e.answer) && (
            <details className="mt-3 rounded-lg bg-[#faf9f7] px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-gray-600">Original question &amp; answer</summary>
              {e.question && <p className="mt-2 text-xs text-gray-800"><span className="font-medium">Q:</span> {e.question}</p>}
              {e.answer && (
                <p className="mt-1.5 flex gap-1 whitespace-pre-wrap text-xs text-gray-600">
                  <CornerDownRight size={12} className="mt-0.5 flex-shrink-0" />
                  {stripCitations(e.answer).slice(0, 1500)}
                  {e.answer.length > 1500 ? '…' : ''}
                </p>
              )}
            </details>
          )}

          {e.guardian_note && <p className="mt-3 text-xs text-gray-500"><span className="font-medium text-gray-700">Your note:</span> {e.guardian_note}</p>}

          {canEdit && (
            <div className="mt-4 border-t border-[#f0efec] pt-3">
              {declining === e.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={note}
                    onChange={(ev) => setNote(ev.target.value)}
                    rows={2}
                    placeholder="Optional note for the sender (e.g. why it isn’t changing)"
                    className="w-full rounded border border-[#e5e3df] p-2.5 text-sm focus:border-black focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => act(e.id, 'decline', { note })} disabled={busy === e.id} className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Decline</button>
                    <button onClick={() => setDeclining(null)} className="rounded-lg px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">Cancel</button>
                  </div>
                </div>
              ) : e.status === 'open' ? (
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => act(e.id, 'accept')} disabled={busy === e.id} className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900 disabled:opacity-50">
                    <Check size={12} /> Accept &amp; edit
                  </button>
                  <button onClick={() => { setDeclining(e.id); setNote('') }} disabled={busy === e.id} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    <X size={12} /> Decline
                  </button>
                  <button onClick={() => act(e.id, 'done')} disabled={busy === e.id} className="rounded-lg border border-[#e5e3df] px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    Mark done
                  </button>
                </div>
              ) : (
                <button onClick={() => act(e.id, 'reopen')} disabled={busy === e.id} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-black">
                  <RotateCcw size={11} /> Reopen
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
