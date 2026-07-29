'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ShieldCheck, CalendarClock, TrendingUp, CalendarDays, Award, Sparkles, Check } from 'lucide-react'
import Button from './Button'

// ────────────────────────────────────────────────────────────────────────────
// AiDisclaimerModal — a fact-checking reminder shown whenever an AI (Claude)
// generation starts: research + interview questions, transcript refine/translate,
// and Business-Case / Editorial-Brief generation.
//
// Non-blocking: the generation proceeds behind it; the user dismisses with
// "I understand". Pair it with `useAiDisclaimer(active)`, which opens the modal
// on each idle → busy transition (including an auto-start already busy on mount).
// ────────────────────────────────────────────────────────────────────────────

// Opens the disclaimer on every transition into an active AI operation. `active`
// should be true whenever a Claude generation/refine/translate is running.
export function useAiDisclaimer(active: boolean) {
  const [open, setOpen] = useState(false)
  const prev = useRef(false)
  useEffect(() => {
    if (active && !prev.current) setOpen(true)
    prev.current = active
  }, [active])
  return { open, dismiss: () => setOpen(false) }
}

const CHECK_ITEMS = [
  {
    icon: CalendarClock,
    title: 'Appointments & career history',
    body: 'Appointment dates, tenure, and career history — the single most common source of errors.',
  },
  {
    icon: TrendingUp,
    title: 'Macroeconomic figures',
    body: 'GDP, foreign direct investment, trade, and other macroeconomic figures.',
  },
  {
    icon: CalendarDays,
    title: 'Event dates',
    body: 'Any date tied to an event, summit, deal, or agreement.',
  },
  {
    icon: Award,
    title: 'Awards & rankings',
    body: 'Awards, rankings, and results — confirm they are current and not outdated.',
  },
]

const backdrop = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

const panel = {
  hidden: { opacity: 0, scale: 0.94, y: 16 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 320, damping: 26, mass: 0.9 },
  },
  exit: { opacity: 0, scale: 0.96, y: 10, transition: { duration: 0.15 } },
}

const list = {
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.12 } },
}

const item = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 380, damping: 30 } },
}

export default function AiDisclaimerModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={{ duration: 0.2 }}
        >
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-disclaimer-title"
            className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Header band */}
            <div className="relative overflow-hidden bg-gradient-to-br from-red-500 via-red-500 to-rose-600 px-6 py-5">
              <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/10" />
              <div className="pointer-events-none absolute -bottom-10 right-16 h-20 w-20 rounded-full bg-white/10" />
              <div className="relative flex items-center gap-3">
                <motion.span
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/20 text-white shadow-inner ring-1 ring-white/30"
                  initial={{ rotate: -12, scale: 0.6, opacity: 0 }}
                  animate={{ rotate: 0, scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.05 }}
                >
                  <ShieldCheck size={22} />
                </motion.span>
                <div>
                  <h3 id="ai-disclaimer-title" className="text-lg font-semibold leading-tight text-white">
                    Before you rely on this
                  </h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-red-50/90">
                    <Sparkles size={12} />
                    AI-generated — verify before publication
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 pb-6 pt-5">
              <p className="text-sm leading-relaxed text-gray-600">
                The AI is a highly capable research assistant, but it is{' '}
                <span className="font-semibold text-gray-900">not always accurate</span>. It can
                get dates, figures, and facts wrong — even when they look confident and well
                sourced. <span className="font-semibold text-gray-900">Cross-checking every fact
                before publication is not optional</span>, especially:
              </p>

              <motion.ul className="mt-4 space-y-2" variants={list} initial="hidden" animate="visible">
                {CHECK_ITEMS.map(({ icon: Icon, title, body }) => (
                  <motion.li
                    key={title}
                    variants={item}
                    className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3"
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-gray-900">{title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{body}</p>
                    </div>
                  </motion.li>
                ))}
              </motion.ul>

              <motion.p
                className="mt-4 rounded-xl border-l-2 border-red-400 bg-red-50/60 px-3.5 py-2.5 text-[13px] italic leading-relaxed text-gray-600"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.42 }}
              >
                Treat every output and generated question as a{' '}
                <span className="font-semibold not-italic text-gray-900">first draft</span> from a
                very fast, very well-read junior researcher: useful, often excellent, but always in
                need of a second pair of eyes before it reaches the client.
              </motion.p>

              <motion.div
                className="mt-6 flex justify-end"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                <Button variant="primary" size="sm" onClick={onClose}>
                  <span className="flex items-center gap-1.5">
                    <Check size={15} />
                    I understand
                  </span>
                </Button>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
