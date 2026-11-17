import type { PresentationExternalFact, RenderedBlock } from '@/types'

// One layout model shared by the Word and PDF builders (same pattern as
// interview-letter-export.ts), so the two formats can't drift apart.
// An APPROVED export is built from its immutable snapshot; a DRAFT export
// from the live rendering and is clearly marked as not approved.

export interface ExportTextPart {
  text: string
  /** An unfilled [PLACEHOLDER] — highlighted so it's spotted in rehearsal. */
  placeholder: boolean
}

// Capturing group: String.split puts the matched placeholders at odd indexes.
const PLACEHOLDER_SPLIT_RE = /(\[[A-Z][A-Z0-9 &/-]*[A-Z0-9]\])/

export function splitPlaceholders(text: string): ExportTextPart[] {
  return text
    .split(PLACEHOLDER_SPLIT_RE)
    .map((part, i) => ({ text: part, placeholder: i % 2 === 1 }))
    .filter((p) => p.text !== '')
}

export interface PresentationExportModel {
  title: string
  identityLines: string[]
  statusLine: string
  isDraft: boolean
  blocks: RenderedBlock[]
  /** Draft exports list unreviewed external facts at the end. */
  factsForReview: PresentationExternalFact[]
}

export function buildExportModel(input: {
  projectName: string
  agency: string
  media: string
  mediaMarket: string
  country: string
  blocks: RenderedBlock[]
  approved: { versionNumber: number; approvedAt: string; approvedBy: string | null } | null
  factsForReview: PresentationExternalFact[]
}): PresentationExportModel {
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return {
    title: 'Commercial Presentation',
    identityLines: [
      input.projectName,
      [input.agency, input.media && `${input.media}${input.mediaMarket ? ` (${input.mediaMarket})` : ''}`, input.country].filter(Boolean).join(' · '),
    ].filter(Boolean),
    statusLine: input.approved
      ? `Approved version ${input.approved.versionNumber} — ${date(input.approved.approvedAt)}${input.approved.approvedBy ? ` by ${input.approved.approvedBy}` : ''}`
      : 'DRAFT — not approved for use',
    isDraft: !input.approved,
    blocks: input.blocks,
    factsForReview: input.approved ? [] : input.factsForReview,
  }
}

export const SEGMENT_EXPORT_LABEL = { say: 'SAY', action: 'ACTION', note: 'NOTE' } as const
