import { supabaseAdmin } from '@/lib/supabase/admin'
import { rankSamples, type RankableSample } from '@/lib/interview-letters'

export const SAMPLE_LIST_COLUMNS = 'id, title, company, variant, sector, notes, filename, size_bytes, char_count, truncated, created_at'

// Normalises the editable tags of a sample letter from a request body.
export function cleanSampleMeta(body: Record<string, unknown>) {
  const company = ['TRC', 'GFDI', 'any'].includes(body.company as string) ? (body.company as string) : 'any'
  const variant = ['anchor', 'no_anchor', 'any'].includes(body.variant as string) ? (body.variant as string) : 'any'
  return {
    company,
    variant,
    sector: typeof body.sector === 'string' ? body.sector.trim() : '',
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
  }
}

export interface LoadedSample extends RankableSample {
  extracted_text: string
}

// The sample letters most relevant to a project (see rankSamples), with their
// text. Ranked from the list first so only the chosen few are downloaded.
export async function loadRelevantSamples(p: {
  company: string
  letter_variant?: string | null
  report_sector?: string | null
  project_country: string
}): Promise<LoadedSample[]> {
  const { data: rows } = await supabaseAdmin
    .from('interview_letter_samples')
    .select('id, title, company, variant, sector, notes, created_at')
    .in('company', [p.company, 'any'])
  const picked = rankSamples((rows || []) as RankableSample[], {
    company: p.company,
    variant: p.letter_variant || 'no_anchor',
    sector: p.report_sector || '',
    country: p.project_country,
  })
  if (picked.length === 0) return []

  const { data: texts } = await supabaseAdmin
    .from('interview_letter_samples')
    .select('id, extracted_text')
    .in('id', picked.map((s) => s.id))
  const byId = new Map((texts || []).map((t) => [t.id as string, (t.extracted_text as string) || '']))
  return picked
    .map((s) => ({ ...s, extracted_text: byId.get(s.id) || '' }))
    .filter((s) => s.extracted_text.trim())
}
