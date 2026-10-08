import type {
  KnowledgeExtractionStatus,
  KnowledgeFeedbackStatus,
  KnowledgeItem,
  KnowledgeItemType,
  KnowledgeItemVersion,
  KnowledgeRating,
} from '@/types'

// Client-safe Knowledge Base constants and display helpers (no server imports).

export const KNOWLEDGE_BUCKET = 'knowledge-base'

export const ITEM_TYPE_LABELS: Record<KnowledgeItemType, string> = {
  document: 'Document',
  text: 'Guide',
  video: 'Video',
  link: 'Link',
}

export const RATING_LABELS: Record<KnowledgeRating, string> = {
  helpful: 'Helpful',
  unclear: 'Unclear',
  incorrect: 'Incorrect',
  outdated: 'Outdated',
  missing: 'Missing information',
}
export const RATING_ORDER: KnowledgeRating[] = ['helpful', 'unclear', 'incorrect', 'outdated', 'missing']

export const FEEDBACK_STATUS_LABELS: Record<KnowledgeFeedbackStatus, string> = {
  open: 'Open',
  accepted: 'Accepted',
  declined: 'Declined',
  done: 'Done',
}

// US-102: PDF, Word and plain text. Old binary .doc isn't readable server-side.
export const UPLOAD_ACCEPT = '.pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown'
export const UPLOAD_EXT_RE = /\.(pdf|docx|txt|md|markdown)$/i
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

// A file whose extraction claimed to start this long ago and never finished is
// treated as stalled (the tab that drove it was closed) and offered a retry.
export const EXTRACTION_STALL_MS = 6 * 60 * 1000

export function isExtractionStalled(v: Pick<KnowledgeItemVersion, 'extraction_status' | 'extraction_started_at' | 'updated_at'>): boolean {
  if (v.extraction_status === 'pending') return true
  if (v.extraction_status !== 'processing') return false
  const started = new Date(v.extraction_started_at || v.updated_at).getTime()
  return Date.now() - started > EXTRACTION_STALL_MS
}

export function extractionLabel(s: KnowledgeExtractionStatus): string {
  switch (s) {
    case 'pending':
    case 'processing':
      return 'Processing'
    case 'needs_attention':
      return 'Needs attention'
    case 'failed':
      return 'Failed'
    default:
      return 'Ready'
  }
}

export type ItemDisplayState =
  | 'draft'
  | 'published'
  | 'published_with_draft'
  | 'archived'
  | 'processing'
  | 'needs_attention'

// The single status shown in the content table (US-119). "Needs attention"
// and "Processing" describe the pending draft, so they win over draft/published.
export function itemDisplayState(
  item: Pick<KnowledgeItem, 'status' | 'draft_version_id'>,
  draft?: Pick<KnowledgeItemVersion, 'extraction_status'> | null,
): ItemDisplayState {
  if (item.status === 'archived') return 'archived'
  if (draft && (draft.extraction_status === 'needs_attention' || draft.extraction_status === 'failed')) return 'needs_attention'
  if (draft && (draft.extraction_status === 'pending' || draft.extraction_status === 'processing')) return 'processing'
  if (item.status === 'published') return item.draft_version_id ? 'published_with_draft' : 'published'
  return 'draft'
}

export const DISPLAY_STATE_META: Record<ItemDisplayState, { label: string; tone: 'emerald' | 'amber' | 'red' | 'sky' | 'stone' }> = {
  draft: { label: 'Draft', tone: 'stone' },
  published: { label: 'Published', tone: 'emerald' },
  published_with_draft: { label: 'Published · draft pending', tone: 'sky' },
  archived: { label: 'Archived', tone: 'stone' },
  processing: { label: 'Processing', tone: 'amber' },
  needs_attention: { label: 'Needs attention', tone: 'red' },
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return ''
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

// Strips the [S#] citation markers for plain-text contexts (chat titles, copy).
export function stripCitations(text: string): string {
  return text.replace(/\s?\[S\d+(?:\s*,\s*S?\d+)*\]/g, '')
}
