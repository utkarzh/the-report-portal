'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState, useTransition, type MouseEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, CalendarDays, Loader2, UserRound } from 'lucide-react'

interface EntityCardProps {
  href: string
  icon: ReactNode
  title: string
  subtitle: string
  date: string
  creatorName?: string | null
  badge?: ReactNode
  metaRight?: ReactNode
  footerLabel: string
  deleteSlot?: ReactNode
  index?: number
}

// The one card shape every list page (meeting-prep, interview, transcriptions,
// documents) renders per item. Previously each page hand-rolled an identical
// block of markup; this centralizes it so a design change lands everywhere
// at once, and adds the two things none of them had: a visible loading state
// during navigation (the click-to-open lag otherwise looks like nothing
// happened) and a staggered entrance so a full page of cards doesn't just
// pop in at once.
export default function EntityCard({
  href, icon, title, subtitle, date, creatorName, badge, metaRight, footerLabel, deleteSlot, index = 0,
}: EntityCardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [clicked, setClicked] = useState(false)
  const busy = isPending || clicked

  // Lets a plain click show an immediate loading state instead of sitting
  // inert until the destination page's data finishes loading — but only for
  // plain left-clicks. Modified clicks (cmd/ctrl/shift/middle) are left alone
  // so opening in a new tab still works exactly like a normal link.
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    setClicked(true)
    startTransition(() => router.push(href))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.3), ease: [0.22, 1, 0.36, 1] }}
      className="group relative"
    >
      {deleteSlot && (
        <div className="absolute right-3 top-3 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {deleteSlot}
        </div>
      )}

      <span className="pointer-events-none absolute inset-y-3 left-0 w-[3px] origin-center scale-y-0 rounded-full bg-[#c8973f] transition-transform duration-300 ease-out group-hover:scale-y-100" />

      <Link
        href={href}
        onClick={handleClick}
        aria-busy={busy}
        className={`block rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:border-[#c8973f]/40 hover:shadow-lg ${busy ? 'pointer-events-none' : ''}`}
      >
        <div className="flex items-start justify-between gap-3 pr-8">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex-shrink-0 rounded-lg bg-black p-2 text-white transition-transform duration-300 group-hover:scale-105">
              {icon}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
              <p className="mt-1 truncate text-xs text-gray-500">{subtitle}</p>
            </div>
          </div>
          {badge && <div className="flex-shrink-0">{badge}</div>}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-gray-400">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <CalendarDays size={12} className="flex-shrink-0" />
            <span className="flex-shrink-0">{date}</span>
            {creatorName && (
              <>
                <span className="flex-shrink-0 text-gray-300">·</span>
                <UserRound size={12} className="flex-shrink-0" />
                <span className="truncate">{creatorName}</span>
              </>
            )}
          </span>
          {metaRight}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[#e5e3df] pt-3 text-sm font-medium text-gray-700">
          <span>{footerLabel}</span>
          <ArrowRight size={16} className="text-gray-400 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-[#a07530]" />
        </div>
      </Link>

      {busy && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 backdrop-blur-[1px]"
        >
          <Loader2 size={20} className="animate-spin text-[#a07530]" />
        </motion.div>
      )}
    </motion.div>
  )
}
