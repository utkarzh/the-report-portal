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
  { icon: CalendarClock, label: 'Appointment dates & tenure' },
  { icon: TrendingUp, label: 'Macroeconomic figures' },
  { icon: CalendarDays, label: 'Event & summit dates' },
  { icon: Award, label: 'Awards & rankings' },
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
            className="relative flex max-h-[95vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
            variants={panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Header band — stays put; only the body below scrolls if it doesn't fit */}
            <div className="relative flex-shrink-0 overflow-hidden bg-gradient-to-br from-red-500 via-red-500 to-rose-600 px-6 py-4">
              <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/10" />
              <div className="pointer-events-none absolute -bottom-10 right-16 h-20 w-20 rounded-full bg-white/10" />
              <div className="relative flex items-center gap-3">
                <motion.span
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/20 text-white shadow-inner ring-1 ring-white/30"
                  initial={{ rotate: -12, scale: 0.6, opacity: 0 }}
                  animate={{ rotate: 0, scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.05 }}
                >
                  <ShieldCheck size={20} />
                </motion.span>
                <div>
                  <h3 id="ai-disclaimer-title" className="text-base font-semibold leading-tight text-white">
                    Before you rely on this
                  </h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-red-50/90">
                    <Sparkles size={12} />
                    AI-generated — verify before publication
                  </p>
                </div>
              </div>
            </div>

            {/* Body — the only scrollable region, so short screens/landscape phones never clip the button */}
            <div className="overflow-y-auto px-6 py-4">
              <p className="text-[13px] leading-relaxed text-gray-600">
                AI research can look confident and still be wrong. Always verify before publication — especially:
              </p>

              <motion.ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" variants={list} initial="hidden" animate="visible">
                {CHECK_ITEMS.map(({ icon: Icon, label }) => (
                  <motion.li
                    key={label}
                    variants={item}
                    className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-2"
                  >
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-red-100 text-red-700">
                      <Icon size={13} />
                    </span>
                    <span className="text-xs font-medium leading-tight text-gray-700">{label}</span>
                  </motion.li>
                ))}
              </motion.ul>

              <motion.p
                className="mt-3 text-xs leading-relaxed text-gray-500"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
              >
                Treat outputs as a first draft — have a second pair of eyes check it before it reaches the client.
              </motion.p>

              <motion.div
                className="mt-4 flex justify-end"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45 }}
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
