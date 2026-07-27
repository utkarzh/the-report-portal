import type { DocType } from '@/types'

// ────────────────────────────────────────────────────────────────────────────
// Shared config for the two "document" modules (Business Cases, Editorial
// Briefs). Both run one generic engine keyed by `doc_type`; everything that
// differs between them lives here. Pure data + helpers only (safe to import on
// server and client) — no lucide/react imports.
// ────────────────────────────────────────────────────────────────────────────

// Private Storage bucket holding admin-uploaded sample documents.
export const DOCUMENT_SAMPLES_BUCKET = 'document-samples'

// Admins may attach at most this many sample documents per module.
export const MAX_SAMPLES = 5

// Per-sample extracted-text cap (chars). Samples can be long (a brief is
// 20-30 pages); this bounds how much of each we feed Claude. ~60k chars ≈ 15k
// tokens per sample.
export const MAX_SAMPLE_CHARS = 60_000

// Accepted sample upload formats.
export const SAMPLE_ACCEPT = '.docx,.pdf,.txt,.md,.markdown'
export const SAMPLE_EXT_RE = /\.(docx|pdf|txt|md|markdown)$/i

export interface DocTypeConfig {
  type: DocType
  /** URL slug for the module's routes, e.g. /business-cases */
  slug: string
  /** Singular label, e.g. "Business Case" */
  label: string
  /** Plural label, e.g. "Business Cases" */
  labelPlural: string
  /** Profile/invitation permission column */
  permissionKey: 'can_access_business_cases' | 'can_access_editorial_briefs'
  /** Middleware-injected header carrying effective access */
  accessHeader: string
  /** max_tokens for the generation call (streamed) */
  maxTokens: number
  /** Cap on server-side web searches per generation */
  maxWebSearches: number
  /** Pre-flight token-budget reserve (headroom gate) */
  tokenReserve: number
  /** Reinforces the target length in the generation prompt */
  lengthGuidance: string
}

export const DOC_TYPES: Record<DocType, DocTypeConfig> = {
  business_case: {
    type: 'business_case',
    slug: 'business-cases',
    label: 'Business Case',
    labelPlural: 'Business Cases',
    permissionKey: 'can_access_business_cases',
    accessHeader: 'x-user-can-business-cases',
    maxTokens: 16_000,
    maxWebSearches: 7,
    tokenReserve: 150_000,
    lengthGuidance:
      'Target roughly 8-10 pages. Prioritise strictly recent, well-sourced data.',
  },
  editorial_brief: {
    type: 'editorial_brief',
    slug: 'editorial-briefs',
    label: 'Editorial Brief',
    labelPlural: 'Editorial Briefs',
    permissionKey: 'can_access_editorial_briefs',
    accessHeader: 'x-user-can-editorial-briefs',
    maxTokens: 32_000,
    maxWebSearches: 10,
    tokenReserve: 300_000,
    lengthGuidance:
      'Target a long, detailed document of roughly 20-30 pages, with real depth in every section.',
  },
}

export const DOC_TYPE_LIST: DocTypeConfig[] = Object.values(DOC_TYPES)

export function isDocType(v: unknown): v is DocType {
  return v === 'business_case' || v === 'editorial_brief'
}

export function getDocConfig(type: DocType): DocTypeConfig {
  return DOC_TYPES[type]
}

export function docConfigBySlug(slug: string): DocTypeConfig | undefined {
  return DOC_TYPE_LIST.find((c) => c.slug === slug)
}
