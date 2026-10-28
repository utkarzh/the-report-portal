'use client'

import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { formatDayMonthYearTime } from '@/lib/date-format'
import type { FinanceAuditEntry } from '@/types'

// The append-only money history (migration 043, client review 26 Oct 2026),
// read back. Either one ticket/funding (entityType + entityId) or a whole
// project (projectId, Finance only). Loads when shown.

const ACTION_LABELS: Record<string, string> = {
  logged: 'Logged',
  edited: 'Edited',
  resubmitted: 'Fixed and resubmitted',
  photo_replaced: 'Receipt photo replaced',
  verified: 'Verified',
  rejected: 'Rejected',
  sent_back: 'Sent back for review',
  removed: 'Removed',
  prior_approval_granted: 'Prior approval granted',
  note_added: 'Note added',
  reconverted: 'Re-converted at a corrected rate',
  funds_recorded: 'Funds recorded',
  funds_edited: 'Funding edited',
  project_created: 'Project created',
  rate_changed: 'Project exchange rate changed',
  rules_changed: 'AI rules changed',
  closed: 'Project closed',
  reopened: 'Project reopened',
  deleted: 'Project deleted',
  transfer_sent: 'Transfer sent',
  transfer_received: 'Transfer received',
}

const FIELD_LABELS: Record<string, string> = {
  concept: 'Concept',
  category: 'Category',
  sub_line: 'Sub-line',
  expense_date: 'Date',
  reference: 'Reference',
  vendor: 'Vendor',
  local_amount: 'Local amount',
  local_currency: 'Local currency',
  exchange_rate_used: 'Exchange rate',
  settlement_amount: 'Converted amount',
  nights: 'Nights',
  status: 'Status',
  rejection_reason: 'Rejection reason',
  receipt_file_path: 'Receipt photo',
  receipt_id: 'Receipt',
  amount: 'Amount credited',
  sent_amount: 'Amount sent',
  sent_currency: 'Currency sent',
  exchange_rate: 'Exchange rate',
  date_sent: 'Date sent',
  proof_files: 'Evidence files',
  ai_rules: 'AI rules',
  name: 'Name',
  country: 'Country',
  settlement_currency: 'Settlement currency',
}

const ENTITY_LABELS: Record<string, string> = { expense: 'Ticket', funding: 'Funding', project: 'Project', transfer: 'Transfer' }

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (field === 'receipt_file_path' || field === 'receipt_id') return 'a photo'
  if (field === 'proof_files') {
    const list = typeof value === 'string' ? safeParse(value) : value
    return Array.isArray(list) && list.length > 0 ? list.map(f => (f as { name?: string })?.name || 'file').join(', ') : 'none'
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}

interface Props {
  entityType?: 'expense' | 'funding'
  entityId?: string
  projectId?: string
}

export default function HistoryList({ entityType, entityId, projectId }: Props) {
  const [entries, setEntries] = useState<FinanceAuditEntry[] | null>(null)

  useEffect(() => {
    const params = projectId ? `projectId=${projectId}` : `entityType=${entityType}&entityId=${entityId}`
    fetch(`/api/finance/history?${params}`)
      .then(r => r.json())
      .then(d => setEntries(d.entries ?? []))
      .catch(() => setEntries([]))
  }, [entityType, entityId, projectId])

  if (!entries) return <div className="text-xs text-gray-400">Loading history…</div>
  if (entries.length === 0) {
    return <div className="text-xs text-gray-400">No recorded changes yet. History is kept from 26 Oct 2026 onwards.</div>
  }

  return (
    <ol className="flex flex-col gap-2">
      {entries.map(e => {
        const changes = Object.entries(e.changes ?? {})
        // A "created" entry lists the starting values; anything else shows old → new.
        const created = changes.every(([, c]) => c.from === null || c.from === undefined)
        return (
          <li key={e.id} className="text-xs border border-[#efeeea] bg-[#faf9f6] rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 flex-wrap">
              <History size={11} className="text-gray-400 flex-shrink-0" />
              {projectId && <span className="text-gray-400">{ENTITY_LABELS[e.entity_type] ?? e.entity_type}</span>}
              <span className="font-semibold text-gray-900">{ACTION_LABELS[e.action] ?? e.action}</span>
              <span className="text-gray-500">by {e.actor_name || 'Unknown'}</span>
              <span className="text-gray-400 ml-auto tabular-nums">{formatDayMonthYearTime(e.created_at)}</span>
            </div>
            {changes.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-0.5 pl-[19px]">
                {changes.map(([field, c]) => (
                  <div key={field} className="text-gray-600 break-words">
                    <span className="text-gray-400">{FIELD_LABELS[field] ?? field}: </span>
                    {created || e.action === 'removed'
                      ? <span>{show(field, e.action === 'removed' ? c.from : c.to)}</span>
                      : <span><span className="line-through text-gray-400">{show(field, c.from)}</span> → {show(field, c.to)}</span>}
                  </div>
                ))}
              </div>
            )}
            {e.note && <div className="mt-1 pl-[19px] text-gray-600 italic break-words">{e.note}</div>}
          </li>
        )
      })}
    </ol>
  )
}
