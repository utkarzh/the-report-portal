'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { Bug, MessageCircle, X, Loader2, CheckCircle2, LifeBuoy, ArrowRight, RotateCw, Inbox } from 'lucide-react'
import type { AppFeedback, FeedbackType } from '@/types'
import {
  RATING_EMOJI,
  RATING_LABEL,
  FEEDBACK_MAX_MESSAGE_LENGTH,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUS_HINTS,
  feedbackStatusOf,
  isFeedbackOpen,
} from '@/lib/feedback'
import { isTouchDevice } from '@/lib/use-mobile'
import FeedbackStatusBadge from './FeedbackStatusBadge'

// "Report an issue", for every signed-in user, admins included. It lives in
// the navigation, never floating over the page: the old corner button
// (bottom-right, z-40) covered real page buttons and made them unclickable.
//   - variant "sidebar": a gold button at the bottom of the sidebar (an icon
//     when the desktop sidebar is collapsed). Also shows in the phone drawer.
//   - variant "topbar": a bug icon in the phone/tablet top bar, so it's one
//     tap away without opening the menu.
// The window has two views: Report (raise an issue or share feedback) and My
// reports (the caller's own reports and their status). Only admins see
// everyone's, at /admin/feedback, where they change the status.
//
// The window is portalled to <body>: the sidebar is a transformed element,
// and a fixed overlay inside it would be positioned and clipped by it.

interface Props {
  variant: 'sidebar' | 'topbar'
  // Sidebar only: the desktop sidebar is collapsed to its icon rail.
  collapsed?: boolean
  // Called before the window opens, e.g. to close the phone drawer.
  onOpen?: () => void
}

export default function ReportIssue({ variant, collapsed = false, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const close = useCallback(() => setOpen(false), [])

  function openWindow() {
    onOpen?.()
    setOpen(true)
  }

  return (
    <>
      {variant === 'topbar' ? (
        <button
          type="button"
          onClick={openWindow}
          aria-label="Report an issue"
          title="Report an issue"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded text-[#e2b866] transition-colors hover:text-white"
        >
          <Bug size={20} />
        </button>
      ) : (
        <button
          type="button"
          onClick={openWindow}
          aria-label="Report an issue"
          title={collapsed ? 'Report an issue' : undefined}
          className={`flex w-full items-center gap-2.5 rounded-lg border border-[#c8973f]/45 bg-[#c8973f]/10 px-3 py-2.5 touch:py-3 text-left transition-colors hover:border-[#c8973f] hover:bg-[#c8973f]/20 ${
            collapsed ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          <Bug size={16} className="flex-shrink-0 text-[#e2b866]" />
          <span className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
            <span className="block text-[13px] font-medium leading-tight text-white">Report an issue</span>
            <span className="mt-0.5 block truncate text-[10px] leading-tight text-gray-400">Or check the ones you sent</span>
          </span>
        </button>
      )}

      {mounted &&
        createPortal(<AnimatePresence>{open && <ReportWindow onClose={close} />}</AnimatePresence>, document.body)}
    </>
  )
}

type View = 'report' | 'mine'

function ReportWindow({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>('report')
  const [type, setType] = useState<FeedbackType>('bug')
  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [mine, setMine] = useState<AppFeedback[] | null>(null)
  const [mineError, setMineError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // The page the problem was seen on, captured when the window opens (this
  // only renders in the browser, after mount). Query string included: it's
  // often what points at the exact item.
  const [pageUrl] = useState(() => window.location.pathname + window.location.search)

  const loadMine = useCallback(async () => {
    setMineError(null)
    try {
      const res = await fetch('/api/feedback', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load your reports.')
      setMine(Array.isArray(data.items) ? data.items : [])
      setIsAdmin(!!data.isAdmin)
    } catch (err) {
      setMineError(err instanceof Error ? err.message : 'Could not load your reports.')
    }
  }, [])

  useEffect(() => {
    loadMine()
  }, [loadMine])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // On a phone the keyboard would cover the sheet, so only focus on desktop.
  useEffect(() => {
    if (view === 'report' && !submitted && !isTouchDevice()) textareaRef.current?.focus()
  }, [view, type, submitted])

  function switchType(next: FeedbackType) {
    setType(next)
    setRating(null)
    setError(null)
  }

  const canSubmit = type === 'review' ? rating !== null || message.trim().length > 0 : message.trim().length > 0

  async function submit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, rating, message: message.trim(), pageUrl }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Something went wrong. Please try again.')
      }
      setSubmitted(true)
      loadMine()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function reportAnother() {
    setRating(null)
    setMessage('')
    setError(null)
    setSubmitted(false)
  }

  function showMine() {
    setView('mine')
    if (submitted) reportAnother()
  }

  const openCount = mine ? mine.filter((m) => isFeedbackOpen(feedbackStatusOf(m.status))).length : 0

  return (
    <motion.div
      className="modal-overlay fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-issue-title"
        className="modal-sheet relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        initial={{ scale: 0.95, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 16, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        <div className="flex-shrink-0 border-b border-[#e5e3df] px-5 pb-0 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <LifeBuoy size={15} className="text-[#c8973f]" />
                <h3 id="report-issue-title" className="text-sm font-semibold text-gray-900">
                  Report an issue
                </h3>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                Something not working? Tell us here and follow its status under My reports.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 flex-shrink-0 rounded-md p-1 touch:p-2.5 text-gray-400 transition-colors hover:bg-[#f7f6f3] hover:text-gray-700"
            >
              <X size={17} />
            </button>
          </div>

          <div className="mt-4 flex gap-5" role="tablist">
            <ViewTab active={view === 'report'} onClick={() => setView('report')} label="Report" />
            <ViewTab
              active={view === 'mine'}
              onClick={() => setView('mine')}
              label="My reports"
              count={openCount > 0 ? openCount : undefined}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {view === 'report' ? (
            submitted ? (
              <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
                >
                  <CheckCircle2 size={26} />
                </motion.div>
                <h4 className="text-sm font-semibold text-gray-900">
                  {type === 'bug' ? 'Thanks, your report has been sent' : 'Thanks for the feedback!'}
                </h4>
                <p className="max-w-[32ch] text-xs leading-relaxed text-gray-500">
                  You can see its status any time under My reports.
                </p>
                <div className="mt-2 flex w-full gap-2.5">
                  <button
                    type="button"
                    onClick={reportAnother}
                    className="flex-1 rounded-lg border border-[#e5e3df] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-700 transition-colors hover:bg-[#f7f6f3]"
                  >
                    Report another
                  </button>
                  <button
                    type="button"
                    onClick={showMine}
                    className="flex-1 rounded-lg bg-black px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-gray-900"
                  >
                    My reports
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-5 py-4">
                <div className="flex gap-1.5">
                  <TypeButton
                    active={type === 'bug'}
                    onClick={() => switchType('bug')}
                    icon={<Bug size={13} />}
                    label="Something’s wrong"
                    danger
                  />
                  <TypeButton
                    active={type === 'review'}
                    onClick={() => switchType('review')}
                    icon={<MessageCircle size={13} />}
                    label="Idea or feedback"
                  />
                </div>

                {type === 'review' && (
                  <div className="mt-4">
                    <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                      How are you finding the app?
                    </p>
                    <div className="flex justify-between gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRating(rating === n ? null : n)}
                          title={RATING_LABEL[n]}
                          aria-label={RATING_LABEL[n]}
                          aria-pressed={rating === n}
                          className={`flex flex-1 flex-col items-center gap-1 rounded-xl border py-2.5 text-xl transition-all ${
                            rating === n
                              ? 'scale-105 border-black bg-[#faf9f7] shadow-sm'
                              : 'border-[#e5e3df] hover:border-gray-300 hover:bg-[#faf9f7]'
                          }`}
                        >
                          <span>{RATING_EMOJI[n]}</span>
                        </button>
                      ))}
                    </div>
                    {rating !== null && (
                      <p className="mt-2 text-center text-[11px] font-medium text-gray-500">{RATING_LABEL[rating]}</p>
                    )}
                  </div>
                )}

                <label
                  htmlFor="report-issue-message"
                  className="mb-1.5 mt-4 block text-[10px] font-semibold uppercase tracking-widest text-gray-500"
                >
                  {type === 'bug' ? 'What went wrong?' : 'Anything you’d like to add? (optional)'}
                </label>
                <textarea
                  id="report-issue-message"
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX_MESSAGE_LENGTH))}
                  placeholder={
                    type === 'bug'
                      ? 'What were you doing, what happened, and what did you expect to happen instead?'
                      : 'Tell us more…'
                  }
                  rows={type === 'bug' ? 5 : 3}
                  className="w-full resize-none rounded-lg border border-[#e5e3df] bg-white p-3 text-sm leading-relaxed placeholder:text-gray-400 focus:border-black focus:outline-none"
                />
                <p className="mt-1.5 truncate text-[11px] text-gray-400" title={pageUrl}>
                  Sent with the page you’re on: <span className="text-gray-500">{pageUrl}</span>
                </p>

                {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit || submitting}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                  {submitting ? 'Sending…' : type === 'bug' ? 'Send report' : 'Send feedback'}
                </button>
              </div>
            )
          ) : (
            <MyReports items={mine} error={mineError} onRetry={loadMine} isAdmin={isAdmin} onClose={onClose} onReport={() => setView('report')} />
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function MyReports({
  items,
  error,
  onRetry,
  isAdmin,
  onClose,
  onReport,
}: {
  items: AppFeedback[] | null
  error: string | null
  onRetry: () => void
  isAdmin: boolean
  onClose: () => void
  onReport: () => void
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
        <p className="text-xs text-red-500">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] px-3 py-2 text-xs font-medium text-gray-700 hover:bg-[#f7f6f3]"
        >
          <RotateCw size={12} /> Try again
        </button>
      </div>
    )
  }

  if (!items) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="px-5 py-4">
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Inbox size={22} className="text-gray-300" />
          <p className="text-xs text-gray-500">You haven’t reported anything yet.</p>
          <button type="button" onClick={onReport} className="mt-1 text-xs font-semibold text-black underline underline-offset-2">
            Report an issue
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => {
            const status = feedbackStatusOf(item.status)
            const isBug = item.type === 'bug'
            const text = item.message || (item.rating ? RATING_LABEL[item.rating] : '')
            return (
              <li key={item.id} className="rounded-xl border border-[#e5e3df] p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-gray-500">
                    {isBug ? <Bug size={12} className="flex-shrink-0 text-red-500" /> : <MessageCircle size={12} className="flex-shrink-0 text-[#a07530]" />}
                    <span className="truncate">
                      {isBug ? 'Issue' : 'Feedback'} · {formatDate(item.created_at)}
                    </span>
                    {item.rating ? <span className="flex-shrink-0 text-sm leading-none">{RATING_EMOJI[item.rating]}</span> : null}
                  </span>
                  <FeedbackStatusBadge status={status} />
                </div>
                {text && <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-800">{text}</p>}
                {(item.page_url || (item.status_updated_at && status !== 'new')) && (
                  <p className="mt-1.5 truncate text-[11px] text-gray-400">
                    {item.status_updated_at && status !== 'new'
                      ? `${FEEDBACK_STATUS_LABELS[status]} on ${formatDate(item.status_updated_at)}`
                      : null}
                    {item.status_updated_at && status !== 'new' && item.page_url ? ' · ' : null}
                    {item.page_url}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <dl className="mt-4 grid grid-cols-1 gap-1 border-t border-[#f0efec] pt-3 text-[11px] text-gray-500 sm:grid-cols-2">
        {FEEDBACK_STATUSES.map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <dt className="font-semibold text-gray-700">{FEEDBACK_STATUS_LABELS[s]}:</dt>
            <dd>{FEEDBACK_STATUS_HINTS[s].toLowerCase()}</dd>
          </div>
        ))}
      </dl>

      {isAdmin && (
        <Link
          href="/admin/feedback"
          onClick={onClose}
          className="mt-4 flex items-center justify-between rounded-lg bg-[#faf6ec] px-3 py-2.5 text-xs font-semibold text-[#7a5a22] transition-colors hover:bg-[#f5edd9]"
        >
          See everyone’s reports and change their status
          <ArrowRight size={13} />
        </Link>
      )}
    </div>
  )
}

function ViewTab({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-semibold transition-colors ${
        active ? 'border-black text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-700'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-700" title={`${count} still open`}>
          {count}
        </span>
      )}
    </button>
  )
}

function TypeButton({
  active,
  onClick,
  icon,
  label,
  danger,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 touch:py-2.5 text-[11px] font-semibold transition-colors ${
        active ? (danger ? 'bg-red-600 text-white' : 'bg-black text-white') : 'bg-[#f7f6f3] text-gray-500 hover:bg-[#efede9]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
