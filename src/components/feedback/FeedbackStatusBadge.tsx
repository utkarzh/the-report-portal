import type { FeedbackStatus } from '@/types'
import { FEEDBACK_STATUS_HINTS, FEEDBACK_STATUS_LABELS, FEEDBACK_STATUS_STYLES } from '@/lib/feedback'

// The status pill, shared by "My reports" (ReportIssue.tsx) and the admin
// list, so a reporter and an admin always see the same label for a report.
// No hooks, so server components can render it too.
export default function FeedbackStatusBadge({ status }: { status: FeedbackStatus }) {
  const style = FEEDBACK_STATUS_STYLES[status]
  return (
    <span
      title={FEEDBACK_STATUS_HINTS[status]}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {FEEDBACK_STATUS_LABELS[status]}
    </span>
  )
}
