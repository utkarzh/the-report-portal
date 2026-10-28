import { supabaseAdmin } from '@/lib/supabase/admin'
import type { FinanceAuditEntity, FinanceFieldChange } from '@/types'

// The append-only money history (migration 043, client review 26 Oct 2026):
// every action that touches money or status records who, when, what and
// each field's old → new value, so a verified ticket, a funding or a project
// rate can never change silently again. Writes are best-effort — a history
// write that fails (e.g. before 043 has run) is logged, never blocks the
// action itself.

export interface HistoryActor {
  id: string
  full_name: string | null
  email: string | null
}

export interface HistoryEntry {
  projectId: string
  entityType: FinanceAuditEntity
  entityId: string
  action: string
  actor: HistoryActor | null
  changes?: Record<string, FinanceFieldChange>
  note?: string | null
}

export async function recordHistory(entries: HistoryEntry | HistoryEntry[]) {
  const list = Array.isArray(entries) ? entries : [entries]
  if (list.length === 0) return
  const { error } = await supabaseAdmin.from('finance_audit_log').insert(list.map(e => ({
    project_id: e.projectId,
    entity_type: e.entityType,
    entity_id: e.entityId,
    action: e.action,
    actor_id: e.actor?.id ?? null,
    actor_name: e.actor ? (e.actor.full_name || e.actor.email || 'Unknown') : 'System',
    changes: e.changes ?? {},
    note: e.note ?? null,
  })))
  if (error) console.error('Recording finance history failed:', error.message)
}

function normalise(v: unknown): unknown {
  if (v === undefined || v === '') return null
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v)
  return v
}

// The fields that actually changed between two versions of a row — numbers
// compared as numbers (PostgREST returns NUMERIC either way), empty string
// and null treated alike.
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): Record<string, FinanceFieldChange> {
  const changes: Record<string, FinanceFieldChange> = {}
  for (const f of fields) {
    if (normalise(before[f]) !== normalise(after[f])) changes[f] = { from: before[f] ?? null, to: after[f] ?? null }
  }
  return changes
}

export const EXPENSE_HISTORY_FIELDS = [
  'concept', 'category', 'sub_line', 'expense_date', 'reference', 'vendor', 'local_amount', 'local_currency',
  'exchange_rate_used', 'settlement_amount', 'nights', 'status', 'rejection_reason', 'receipt_file_path', 'receipt_id',
] as const

export const FUNDING_HISTORY_FIELDS = [
  'amount', 'sent_amount', 'sent_currency', 'exchange_rate', 'date_sent', 'concept', 'proof_files',
] as const
