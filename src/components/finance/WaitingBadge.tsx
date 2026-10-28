'use client'

import { Clock } from 'lucide-react'
import { waitingDays } from '@/lib/finance-ledger'

// How long a pending ticket has been waiting for review — grey for under a
// week, amber from 7 days, red from 14 (client review, 26 Oct 2026). Shown on
// pending rows in both ledgers and in the review queue.
export default function WaitingBadge({ loggedAt }: { loggedAt: string }) {
  const days = waitingDays(loggedAt)
  const style = days >= 14 ? 'bg-red-50 text-red-700' : days >= 7 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${style}`}
      title="Days since this ticket was logged, still waiting for Finance"
    >
      <Clock size={10} /> {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}
    </span>
  )
}
