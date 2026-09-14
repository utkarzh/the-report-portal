import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  SALES_COACH_KNOWLEDGE_DOCS,
  formatOutcomeDetails,
  outcomeLabel,
  pickTranscript,
} from '@/lib/sales-coach'
import type { SalesCoachKnowledgeDoc, SalesCoachKnowledgeKey, SalesCoachNegotiation } from '@/types'

// Server-only prompt assembly for the Sales Coach module, shared by the
// Report Card analysis and the coaching conversation so both reason from the
// SAME knowledge block and the SAME description of the submission.

export interface KnowledgeBundle {
  // The four docs in fixed authority order, each under a labelled banner.
  block: string
  // Raw Project Prompt text — snapshotted onto the negotiation (US-048).
  projectPrompt: string
  // updated_at per doc — recorded as `knowledge_versions` so a later edit to a
  // doc never silently rewrites what produced a past card.
  versions: Record<SalesCoachKnowledgeKey, string | null>
  // Docs that are still empty or the migration's placeholder text.
  missing: SalesCoachKnowledgeKey[]
}

function isPlaceholder(content: string): boolean {
  const t = content.trim()
  return t.length === 0 || t.toUpperCase().startsWith('PLACEHOLDER')
}

export async function loadKnowledgeBundle(): Promise<KnowledgeBundle> {
  const { data: docs } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .select('doc_key, content, updated_at')

  const byKey = new Map<string, Partial<SalesCoachKnowledgeDoc>>()
  for (const d of docs || []) byKey.set(d.doc_key, d as Partial<SalesCoachKnowledgeDoc>)

  const versions = {} as Record<SalesCoachKnowledgeKey, string | null>
  const missing: SalesCoachKnowledgeKey[] = []

  const block = SALES_COACH_KNOWLEDGE_DOCS.map(({ key, label }, i) => {
    const doc = byKey.get(key)
    const content = (doc?.content || '').trim()
    versions[key] = doc?.updated_at ?? null
    if (isPlaceholder(content)) missing.push(key)
    const authority = i === 0 ? ' (HIGHEST AUTHORITY)' : key === 'examples' ? ' (pattern recognition only)' : ''
    return `===== ${label}${authority} =====\n${isPlaceholder(content) ? '(not provided)' : content}`
  }).join('\n\n')

  return {
    block,
    projectPrompt: (byKey.get('project_prompt')?.content || '').trim(),
    versions,
    missing,
  }
}

// Everything the executive typed on the submission form, as a metadata block.
// Off-audio facts (a signed agreement, the declared price) live here — the
// contract tells the model to treat them as factual unless the transcript
// materially contradicts them.
export function buildNegotiationContext(n: SalesCoachNegotiation): string {
  const reps = (n.company_reps || []).map((p) => [p.name, p.role].filter(Boolean).join(' — ')).filter(Boolean)
  const trc = (n.trc_members || []).map((p) => [p.name, p.role].filter(Boolean).join(' — ')).filter(Boolean)
  const details = formatOutcomeDetails(n.declared_outcome, n.outcome_details)

  const lines = [
    '--- NEGOTIATION CONTEXT (submitted by the Sales Executive) ---',
    `Submitted by: ${n.submitted_by_name || '—'}`,
    `Company: ${n.company || '—'}`,
    `Country: ${n.country || '—'}`,
    `Media / publication: ${n.media_publication || '—'}`,
    `Interviewee (the buyer / CEO): ${[n.interviewee_name, n.interviewee_position].filter(Boolean).join(' — ') || '—'}`,
    `Company representatives present: ${reps.length ? reps.join('; ') : '—'}`,
    `TRC team members present: ${trc.length ? trc.join('; ') : '—'}`,
    `Declared outcome: ${outcomeLabel(n.declared_outcome)}`,
  ]
  for (const row of details) lines.push(`  ${row.label}: ${row.value}`)
  if (n.other_comments) lines.push(`Other comments from the executive: ${n.other_comments}`)
  // Original filename, for context only — never overrides the typed Company
  // field above, which the code already prioritised when the row was created.
  if (n.original_filename) lines.push(`Original recording filename: ${n.original_filename}`)
  return lines.join('\n')
}

export function buildTranscriptBlock(n: SalesCoachNegotiation): string {
  const t = pickTranscript(n)
  if (!t) return '--- NEGOTIATION TRANSCRIPT ---\n(No transcript available.)'
  const origin = t.source === 'system'
    ? 'Transcribed from the meeting audio with automatic speaker labels ("Speaker A", "Speaker B", …). Use the context above to work out which speaker is the Sales Executive and which is the buyer.'
    : 'Transcript supplied by the Sales Executive.'
  return `--- NEGOTIATION TRANSCRIPT ---\n${origin}\n\n${t.text}`
}
