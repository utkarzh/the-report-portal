'use client'

import { useState } from 'react'
import { MessageSquare, Send, Undo2 } from 'lucide-react'
import { formatDayMonthYearTime } from '@/lib/date-format'
import type { FinanceCommentSide, FinanceExpenseComment, FinanceExpenseStatus } from '@/types'

interface Props {
  expenseId: string
  status: FinanceExpenseStatus
  comments: FinanceExpenseComment[]
  viewerSide: FinanceCommentSide
  // Field view of a rejected ticket the viewer may answer by sending it back
  // for review — its uploader or the project's Director (the route checks).
  canSendBack?: boolean
  // Called after a successful post; sentBack = the ticket is pending again.
  onPosted?: (comment: FinanceExpenseComment, sentBack: boolean) => void
  // Long lists (the review queue): the composer stays behind an "Add a
  // comment" link until it's wanted.
  startCollapsed?: boolean
  // A closed project: the thread is shown, nothing can be added.
  readOnly?: boolean
}

const KIND_LABEL: Record<FinanceExpenseComment['kind'], { text: string; style: string } | null> = {
  comment: null,
  rejection: { text: 'Rejected', style: 'bg-red-50 text-red-700' },
  resubmission: { text: 'Sent back for review', style: 'bg-amber-50 text-amber-700' },
}

// One ticket's conversation between Finance and the field team (migration
// 042, client feedback 26 Oct 2026). The headline case: Finance rejects a
// Saturday taxi asking whether a meeting took place; the ticket is right as it
// is, so the field user answers here and sends it back — no new receipt.
export default function ExpenseThread({ expenseId, status, comments, viewerSide, canSendBack, onPosted, startCollapsed, readOnly }: Props) {
  const [composerOpen, setComposerOpen] = useState(!startCollapsed)
  const [posted, setPosted] = useState<FinanceExpenseComment[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<'comment' | 'sendBack' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sentBack, setSentBack] = useState(false)

  const thread = [...comments, ...posted.filter(p => !comments.some(c => c.id === p.id))]
  const offerSendBack = canSendBack && viewerSide === 'field' && status === 'rejected' && !sentBack

  async function post(sendBack: boolean) {
    if (!draft.trim()) { setError('Write a comment first.'); return }
    setBusy(sendBack ? 'sendBack' : 'comment')
    setError(null)
    const res = await fetch(`/api/finance/expenses/${expenseId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: draft, sendBack }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok || !data.comment) {
      setError(data.error || 'Failed to post the comment.')
      return
    }
    setPosted(prev => [...prev, data.comment])
    setDraft('')
    if (sendBack) setSentBack(true)
    onPosted?.(data.comment, sendBack)
  }

  const hint = viewerSide === 'finance'
    ? 'The person who logged this ticket is notified by email.'
    : offerSendBack
      ? 'If the ticket is correct as it is, explain why and send it back — no need to upload it again.'
      : 'Finance is notified by email.'

  return (
    <div>
      <div className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
        <MessageSquare size={11} /> Comments{thread.length > 0 ? ` · ${thread.length}` : ''}
      </div>

      {thread.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          {thread.map(c => {
            const label = KIND_LABEL[c.kind]
            const mine = c.author_side === viewerSide
            return (
              <div
                key={c.id}
                className={`rounded-lg border px-3 py-2.5 ${c.author_side === 'finance' ? 'bg-[#faf9f6] border-[#e5e3df]' : 'bg-white border-[#e5e3df]'} ${mine ? '' : 'shadow-sm'}`}
              >
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <span className="font-semibold text-gray-900">{c.author_name || 'Unknown'}</span>
                  <span className="text-gray-400">{c.author_side === 'finance' ? 'Finance' : 'Field team'}</span>
                  {label && <span className={`font-medium px-1.5 py-0.5 rounded ${label.style}`}>{label.text}</span>}
                  <span className="text-gray-400 ml-auto tabular-nums">{formatDayMonthYearTime(c.created_at)}</span>
                </div>
                {c.message
                  ? <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap break-words">{c.message}</div>
                  : c.kind === 'resubmission' && <div className="text-xs text-gray-500 mt-1 italic">Resubmitted with corrections.</div>}
              </div>
            )
          })}
        </div>
      )}

      {sentBack && (
        <div className="p-2.5 mb-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 rounded-lg">
          Sent back to Finance for review.
        </div>
      )}
      {error && <div className="p-2.5 mb-2 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">{error}</div>}

      {readOnly ? (
        thread.length === 0 && <div className="text-xs text-gray-400">No comments.</div>
      ) : !composerOpen ? (
        <button
          onClick={() => setComposerOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          <MessageSquare size={12} /> Add a comment
        </button>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder={viewerSide === 'finance'
              ? 'e.g. This taxi is on a Saturday — did a meeting take place that day?'
              : offerSendBack
                ? 'e.g. Yes — the taxi was to the Saturday meeting with the Minister of Trade.'
                : 'Add a comment for Finance…'}
            className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400 transition-colors"
          />
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {offerSendBack && (
              <button
                onClick={() => post(true)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-black text-white rounded-lg px-3.5 py-2 hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                <Undo2 size={13} /> {busy === 'sendBack' ? 'Sending…' : 'Reply & send back for review'}
              </button>
            )}
            <button
              onClick={() => post(false)}
              disabled={busy !== null}
              className={offerSendBack
                ? 'inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-[#e5e3df] bg-white rounded-lg px-3 py-2 hover:border-gray-300 disabled:opacity-50 transition-colors'
                : 'inline-flex items-center gap-1.5 text-xs font-medium bg-black text-white rounded-lg px-3.5 py-2 hover:bg-gray-800 disabled:opacity-50 transition-colors'}
            >
              <Send size={12} /> {busy === 'comment' ? 'Posting…' : offerSendBack ? 'Comment only' : 'Post comment'}
            </button>
            <span className="text-[11px] text-gray-400">{hint}</span>
          </div>
        </>
      )}
    </div>
  )
}

// One-line preview of a ticket's latest message for the ledger rows — so a
// reply to a rejection, or the uploader's own explanation, is visible
// without opening the ticket.
export function LatestCommentPreview({ comments }: { comments?: FinanceExpenseComment[] }) {
  if (!comments || comments.length === 0) return null
  const last = comments[comments.length - 1]
  // The rows already print "Rejected: <reason>" for a rejected ticket, so a
  // rejection as the latest message only adds the count.
  if (last.kind === 'rejection') {
    return comments.length > 1 ? (
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1.5">
        <MessageSquare size={11} /> {comments.length} comments
      </div>
    ) : null
  }
  const full = last.message || (last.kind === 'resubmission' ? 'Resubmitted with corrections.' : '')
  const text = full.length > 140 ? `${full.slice(0, 137)}…` : full
  return (
    <div className="flex items-start gap-1.5 text-xs text-gray-600 mt-1.5 max-w-md">
      <MessageSquare size={11} className="flex-shrink-0 mt-0.5 text-gray-400" />
      <span className="min-w-0 break-words">
        <span className="font-medium text-gray-700">{last.author_name || 'Unknown'}</span>
        {last.kind === 'resubmission' && <span className="text-amber-700"> · sent back</span>}
        {text && <>: {text}</>}
        {comments.length > 1 && <span className="text-gray-400"> · {comments.length} comments</span>}
      </span>
    </div>
  )
}

// A pending ticket the field team sent back after a rejection (and Finance
// hasn't rejected again since) — told apart from a fresh one in the ledgers
// and the review queue, since it's an answer Finance is waiting on.
export function wasSentBack(status: FinanceExpenseStatus, comments?: FinanceExpenseComment[]): boolean {
  if (status !== 'pending' || !comments) return false
  for (let i = comments.length - 1; i >= 0; i--) {
    if (comments[i].kind === 'resubmission') return true
    if (comments[i].kind === 'rejection') return false
  }
  return false
}

export function SentBackBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700" title="Rejected earlier — sent back for review with a reply or corrections">
      <Undo2 size={10} /> sent back
    </span>
  )
}
