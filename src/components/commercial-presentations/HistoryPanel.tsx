'use client'

import { Download } from 'lucide-react'
import { API_PATH, EVENT_LABELS } from '@/lib/commercial-presentations'
import { formatCost, formatTokens } from '@/lib/claude/tokens'
import type { WorkspaceApi } from './PresentationWorkspace'
import { Card, CardHeader } from './ui'

// Step 5 — history (brief §22): every approved snapshot (each exportable as
// it was approved) and the audit trail of what happened, by whom.

export default function HistoryPanel({ api }: { api: WorkspaceApi }) {
  const { state } = api
  const { snapshots, events, presentation } = state
  return (
    <Card>
      <CardHeader
        title="History"
        description={`AI spend on this presentation: ${formatCost(Number(presentation.cost_usd || 0))} · ${formatTokens(presentation.tokens_total || 0)} tokens${presentation.web_searches ? ` · ${presentation.web_searches} web searches` : ''}.`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Approved versions</p>
          {snapshots.length === 0 ? (
            <p className="text-sm text-gray-500">Not approved yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {snapshots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e5e3df] px-3 py-2">
                  <span className="text-sm text-gray-800">
                    v{s.versionNumber}
                    {s.id === presentation.approved_snapshot_id && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">In use</span>}
                    <span className="block text-xs text-gray-500">
                      {new Date(s.approvedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                      {s.approvedByName ? ` · ${s.approvedByName}` : ''}
                      {s.editedOnApproval ? ' · edited on approval' : ''}
                    </span>
                  </span>
                  <span className="flex gap-1.5">
                    {(['docx', 'pdf'] as const).map((f) => (
                      <a
                        key={f}
                        href={`${API_PATH}/${presentation.id}/export?format=${f}&snapshot=${s.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#e5e3df] px-2 py-1 text-[11px] text-gray-600 hover:text-black"
                      >
                        <Download size={11} /> {f === 'docx' ? 'Word' : 'PDF'}
                      </a>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Activity</p>
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {events.map((e) => (
              <li key={e.id} className="text-xs text-gray-600">
                <span className="font-medium text-gray-800">{EVENT_LABELS[e.event_type] || e.event_type}</span>
                {e.actorName ? ` · ${e.actorName}` : ''} · {new Date(e.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                {e.comment && <span className="mt-0.5 block italic text-gray-500">“{e.comment}”</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}
