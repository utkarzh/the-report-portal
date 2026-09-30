import type { FeedbackType } from '@/types'

// Shared between FeedbackWidget.tsx (submission) and /admin/feedback
// (display) so the two never drift on what a rating or type means.

export const FEEDBACK_MAX_MESSAGE_LENGTH = 4000

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
  review: 'Review',
  bug: 'Bug report',
}

export function isFeedbackType(v: unknown): v is FeedbackType {
  return v === 'review' || v === 'bug'
}
