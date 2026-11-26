import type { FeedbackStatus, FeedbackType } from '@/types'

// Shared between ReportIssue.tsx (raising + "My reports"), the API routes
// and /admin/feedback (everyone's reports), so they never drift on what a
// rating, type or status means.

export const FEEDBACK_MAX_MESSAGE_LENGTH = 4000

// "Report an issue": the button at the bottom of the sidebar and the bug icon
// in the phone top bar, for every signed-in user, admins included. It was a
// floating corner button until 19 Oct 2026, hidden because it covered page
// buttons; it now lives in the navigation, where it can't cover anything.
// Set to false to hide it again. Past reports stay readable at
// /admin/feedback either way.
export const REPORT_ISSUE_ENABLED = true

export const RATING_EMOJI: Record<number, string> = {
  1: '😞',
  2: '🙁',
  3: '😐',
  4: '🙂',
  5: '😍',
}

export const RATING_LABEL: Record<number, string> = {
  1: 'Not good',
  2: 'Could be better',
  3: 'It’s okay',
  4: 'Good',
  5: 'Love it',
}

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  review: 'Feedback',
  bug: 'Issue',
}

export function isFeedbackType(v: unknown): v is FeedbackType {
  return v === 'review' || v === 'bug'
}

// Admins move a report through these (migration 051). The reporter sees the
// same label and hint under "My reports".
export const FEEDBACK_STATUSES: FeedbackStatus[] = ['new', 'in_progress', 'resolved', 'closed']

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const FEEDBACK_STATUS_HINTS: Record<FeedbackStatus, string> = {
  new: 'Waiting to be looked at',
  in_progress: 'Being worked on',
  resolved: 'Fixed or done',
  closed: 'No change planned',
}

export const FEEDBACK_STATUS_STYLES: Record<FeedbackStatus, { badge: string; dot: string }> = {
  new: { badge: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  in_progress: { badge: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  resolved: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  closed: { badge: 'border-gray-200 bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
}

export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === 'string' && (FEEDBACK_STATUSES as string[]).includes(v)
}

// Rows from before migration 051 can still say 'reviewed' (the old "Mark
// reviewed" button), which meant an admin had dealt with it: Closed.
export function feedbackStatusOf(raw: string | null | undefined): FeedbackStatus {
  if (raw === 'reviewed') return 'closed'
  return isFeedbackStatus(raw) ? raw : 'new'
}

// The values to filter on for one status, so a pre-051 'reviewed' row still
// lands under Closed.
export function storedStatusesFor(status: FeedbackStatus): string[] {
  return status === 'closed' ? ['closed', 'reviewed'] : [status]
}

export function isFeedbackOpen(status: FeedbackStatus): boolean {
  return status === 'new' || status === 'in_progress'
}
