'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageCircle, Bug, X, Loader2, CheckCircle2, Sparkles } from 'lucide-react'
import type { FeedbackType } from '@/types'
import { RATING_EMOJI, RATING_LABEL, FEEDBACK_MAX_MESSAGE_LENGTH } from '@/lib/feedback'

// App-wide, entirely opt-in feedback entry point: a small floating button on
// every dashboard/admin page (mounted once in AppShell). Nothing here ever
// appears uninvited — there is no popup-on-load, no nagging, no "you already
// reviewed" tracking to build, because the widget simply waits to be
// clicked. A user can submit as many times as they like; each submit shows a
// "Submit another" option rather than closing them out.
export default function FeedbackWidget() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('review')
  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  function reset() {
    setType('review')
    setRating(null)
    setMessage('')
    setError(null)
    setSubmitted(false)
  }

  function close() {
    setOpen(false)
    // Small delay so the panel doesn't visibly reset mid-close animation.
    setTimeout(reset, 200)
  }

  function switchType(next: FeedbackType) {
    setType(next)
    setRating(null)
    setError(null)
  }

  const canSubmit = type === 'review' ? rating !== null : message.trim().length > 0

  async function submit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, rating, message: message.trim(), pageUrl: pathname }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Something went wrong. Please try again.')
      }
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function submitAnother() {
    setRating(null)
    setMessage('')
    setError(null)
    setSubmitted(false)
  }

  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.96 }}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-black px-4 py-3 text-white shadow-lg transition-shadow hover:shadow-xl"
        aria-label="Give feedback"
      >
        <MessageCircle size={16} />
        <span className="text-xs font-semibold tracking-wide">Feedback</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:items-center sm:justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/40" onClick={close} />

            <motion.div
              className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
              initial={{ scale: 0.95, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 16, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            >
              <button
                onClick={close}
                className="absolute right-4 top-4 z-10 rounded-md p-1 text-gray-400 transition-colors hover:bg-[#f7f6f3] hover:text-gray-700"
              >
                <X size={17} />
              </button>

              {submitted ? (
                <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
                  >
                    <CheckCircle2 size={26} />
                  </motion.div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {type === 'bug' ? 'Thanks — we’ll take a look' : 'Thanks for the feedback!'}
                  </h3>
                  <p className="max-w-[26ch] text-xs text-gray-500">
                    {type === 'bug'
                      ? 'Your report has been sent to the team.'
                      : 'It genuinely helps us make the tool better.'}
                  </p>
                  <div className="mt-2 flex w-full gap-2.5">
                    <button
                      onClick={submitAnother}
                      className="flex-1 rounded-lg border border-[#e5e3df] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-700 transition-colors hover:bg-[#f7f6f3]"
                    >
                      Submit another
                    </button>
                    <button
                      onClick={close}
                      className="flex-1 rounded-lg bg-black px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-gray-900"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="border-b border-[#e5e3df] px-5 pb-4 pt-5">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Sparkles size={14} className="text-[#c8973f]" />
                      <h3 className="text-sm font-semibold text-gray-900">How's it going?</h3>
                    </div>
                    <p className="text-[11px] text-gray-400">We read every message. Share as often as you like.</p>
                  </div>

                  <div className="flex gap-1.5 px-5 pt-4">
                    <TabButton active={type === 'review'} onClick={() => switchType('review')} icon={<MessageCircle size={13} />} label="Share feedback" />
                    <TabButton active={type === 'bug'} onClick={() => switchType('bug')} icon={<Bug size={13} />} label="Report a bug" danger />
                  </div>

                  <div className="px-5 py-4">
                    {type === 'review' ? (
                      <div className="mb-4">
                        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                          How are you feeling about the app?
                        </p>
                        <div className="flex justify-between gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              onClick={() => setRating(n)}
                              title={RATING_LABEL[n]}
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
                    ) : (
                      <div className="mb-1 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">
                        <Bug size={13} className="flex-shrink-0" />
                        Tell us what happened — we'll dig in.
                      </div>
                    )}

                    <label className="mb-1.5 mt-3 block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                      {type === 'bug' ? 'What went wrong?' : 'Anything you’d like to add? (optional)'}
                    </label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX_MESSAGE_LENGTH))}
                      placeholder={type === 'bug' ? 'What did you do, and what did you expect to happen instead?' : 'Tell us more…'}
                      rows={4}
                      className="w-full resize-none rounded-lg border border-[#e5e3df] bg-white p-3 text-sm leading-relaxed placeholder:text-gray-400 focus:border-black focus:outline-none"
                    />

                    {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

                    <button
                      onClick={submit}
                      disabled={!canSubmit || submitting}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                      {submitting ? 'Sending…' : type === 'bug' ? 'Send report' : 'Send feedback'}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function TabButton({ active, onClick, icon, label, danger }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors ${
        active
          ? danger
            ? 'bg-red-600 text-white'
            : 'bg-black text-white'
          : 'bg-[#f7f6f3] text-gray-500 hover:bg-[#efede9]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
