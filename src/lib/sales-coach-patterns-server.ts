// Server-only reads for the Sales Coach pattern analysis
// (/commercial/admin/sales-coach/patterns). See sales-coach-patterns.ts.
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  PATTERN_ROW_COLUMNS, latestCardPerMeeting,
  type PatternAnalysisListItem, type PatternExecutiveOption, type PatternNegotiationRow,
} from '@/lib/sales-coach-patterns'

export const PATTERN_TABLE = 'sales_coach_pattern_analyses'

// Before migration 045 runs the analyses table doesn't exist: analyses still
// stream to the screen, they just aren't kept.
export function isMissingPatternTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === '42P01' || error.code === 'PGRST205' || (message.includes(PATTERN_TABLE) && /does not exist|could not find/i.test(message))
}

// Everyone who has at least one Report Card, with how many distinct meetings
// (a re-evaluated meeting counts once). Deleted users' negotiations
// (user_id NULL) have no one to analyse and are left out.
export async function loadPatternExecutives(): Promise<PatternExecutiveOption[]> {
  const { data } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('user_id, submitted_by_name, created_at')
    .not('report_card', 'is', null)
    .not('user_id', 'is', null)
    .limit(5000)

  const byUser = new Map<string, { meetings: Set<string>; lastAt: string; submittedAs: string | null }>()
  for (const r of (data || []) as { user_id: string; submitted_by_name: string | null; created_at: string }[]) {
    const entry = byUser.get(r.user_id) ?? { meetings: new Set<string>(), lastAt: r.created_at, submittedAs: r.submitted_by_name }
    entry.meetings.add(r.created_at)
    if (r.created_at > entry.lastAt) {
      entry.lastAt = r.created_at
      entry.submittedAs = r.submitted_by_name || entry.submittedAs
    }
    byUser.set(r.user_id, entry)
  }
  const ids = Array.from(byUser.keys())
  if (ids.length === 0) return []

  const { data: profiles } = await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', ids)
  const profileById = new Map((profiles || []).map((p) => [p.id as string, p as { id: string; full_name: string | null; email: string | null }]))

  return ids
    .map((id) => {
      const e = byUser.get(id)!
      const p = profileById.get(id)
      return {
        id,
        name: p?.full_name?.trim() || e.submittedAs?.trim() || p?.email || 'Unnamed user',
        email: p?.email ?? null,
        cards: e.meetings.size,
        lastAt: e.lastAt,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// One executive's Report Cards, one per meeting, newest first.
export async function loadExecutiveCardRows(userId: string): Promise<PatternNegotiationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select(PATTERN_ROW_COLUMNS)
    .eq('user_id', userId)
    .not('report_card', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return latestCardPerMeeting((data || []) as unknown as PatternNegotiationRow[])
}

export async function loadExecutiveName(userId: string, fallback: string | null): Promise<string> {
  const { data } = await supabaseAdmin.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  return data?.full_name?.trim() || fallback?.trim() || data?.email || 'this Sales Executive'
}

// Past analyses of one executive, newest first. `available` is false before
// migration 045 runs.
export async function loadPatternAnalyses(userId: string): Promise<{ analyses: PatternAnalysisListItem[]; available: boolean }> {
  const { data, error } = await supabaseAdmin
    .from(PATTERN_TABLE)
    .select('id, scope, card_count, period_start, period_end, created_by_name, created_at')
    .eq('subject_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) {
    if (!isMissingPatternTable(error)) console.error('Sales coach patterns: history read failed', error.message)
    return { analyses: [], available: !isMissingPatternTable(error) }
  }
  return { analyses: (data || []) as PatternAnalysisListItem[], available: true }
}
