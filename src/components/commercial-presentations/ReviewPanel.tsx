'use client'

import { useState } from 'react'
import { CheckCircle2, Download, RotateCcw, Send, Undo2 } from 'lucide-react'
import { API_PATH, hasBlockingIssues } from '@/lib/commercial-presentations'
import PresentationView from './PresentationView'
import type { WorkspaceApi } from './PresentationWorkspace'
import { Card, CardHeader, FieldLabel, Notice, PrimaryButton, SecondaryButton, inputClass } from './ui'

// Step 4 — review the complete presentation, submit, and Manager/Admin
// approval (brief §19): Approve · Edit and Approve (edit while submitted,
// then approve) · Return for Changes. Approved = locked snapshot; reopen to
// revise, the approved version stays in use until the next approval.

function ExportLinks({ id, which, label }: { id: string; which: 'approved' | 'draft'; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      {(['docx', 'pdf'] as const).map((format) => (
        <a
          key={format}
          href={`${API_PATH}/${id}/export?format=${format}&which=${which}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 hover:text-black"
        >
          <Download size={12} /> {format === 'docx' ? 'Word' : 'PDF'}
        </a>
      ))}
    </div>
  )
}

export default function ReviewPanel({ api }: { api: WorkspaceApi }) {
  const { state, mutate } = api
  const { presentation, issues, permissions, approvedSnapshot } = state
  const [view, setView] = useState<'approved' | 'draft'>(presentation.status === 'approved' && approvedSnapshot ? 'approved' : 'draft')
  const [returning, setReturning] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const blocking = hasBlockingIssues(issues)
  const showingApproved = view === 'approved' && approvedSnapshot
  const blocks = showingApproved ? approvedSnapshot.blocks : state.rendered

  async function act(key: string, path: string, body?: unknown) {
    setBusy(key)
    const ok = await mutate(path, 'POST', body)
    setBusy(null)
    return ok
  }

  return (
    <Card>
      <CardHeader
        step="Step 4"
        title="Review and approval"
        description="The complete presentation as it will be rehearsed. SAY is what to say, ACTION is what to do while saying it. Highlighted [PLACEHOLDERS] still need a value or are filled in live (e.g. the interviewee's name)."
        action={
          approvedSnapshot && presentation.status !== 'approved' ? (
            <div className="inline-flex rounded-xl border border-[#e5e3df] p-0.5 text-xs">
              {(['draft', 'approved'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded-lg px-3 py-1.5 font-medium ${view === v ? 'bg-black text-white' : 'text-gray-600 hover:text-black'}`}
                >
                  {v === 'draft' ? 'Current draft' : `Approved v${approvedSnapshot.version_number}`}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      {!showingApproved && issues.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {issues.map((i, n) => (
            <Notice key={n} tone={i.level === 'error' ? 'error' : 'warn'}>
              {i.message}
            </Notice>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[#e5e3df] bg-[#fcfbf9] p-5">
        <PresentationView blocks={blocks} />
      </div>

      <div className="mt-5 flex flex-col gap-4 border-t border-[#efede9] pt-4">
        {presentation.status === 'draft' && permissions.canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton icon={<Send size={14} />} loading={busy === 'submit'} disabled={blocking} onClick={() => act('submit', '/submit')}>
              Submit for approval
            </PrimaryButton>
            {blocking && <span className="text-xs text-gray-500">Fix the items above first.</span>}
          </div>
        )}

        {presentation.status === 'submitted' &&
          (permissions.canApprove ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-gray-500">
                You can edit any step above before approving (“Edit and Approve”). You can approve a presentation you created or edited yourself.
              </p>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton icon={<CheckCircle2 size={14} />} loading={busy === 'approve'} disabled={blocking} onClick={() => act('approve', '/review', { action: 'approve' })}>
                  Approve and lock
                </PrimaryButton>
                <SecondaryButton icon={<Undo2 size={14} />} onClick={() => setReturning(!returning)}>
                  Return for changes
                </SecondaryButton>
              </div>
              {returning && (
                <div className="flex flex-col gap-2 rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-3">
                  <FieldLabel htmlFor="return-comment">What needs to change?</FieldLabel>
                  <textarea id="return-comment" rows={3} className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} />
                  <div className="flex gap-2">
                    <PrimaryButton
                      loading={busy === 'return'}
                      disabled={!comment.trim()}
                      onClick={async () => {
                        if (await act('return', '/review', { action: 'return', comment })) {
                          setReturning(false)
                          setComment('')
                        }
                      }}
                    >
                      Send back to the team
                    </PrimaryButton>
                    <SecondaryButton onClick={() => setReturning(false)}>Cancel</SecondaryButton>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-600">Submitted — waiting for a Manager or Admin to review it.</p>
          ))}

        {presentation.status === 'approved' && (
          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              icon={<RotateCcw size={14} />}
              loading={busy === 'reopen'}
              onClick={() => act('reopen', '/reopen', { reason: state.masterOutdated ? 'master_update' : 'revision' })}
            >
              {state.masterOutdated ? 'Reopen with the new master content' : 'Reopen for revision'}
            </SecondaryButton>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {approvedSnapshot && <ExportLinks id={presentation.id} which="approved" label={`Approved v${approvedSnapshot.version_number}:`} />}
          {presentation.status !== 'approved' && <ExportLinks id={presentation.id} which="draft" label="Current draft (marked DRAFT):" />}
        </div>
      </div>
    </Card>
  )
}
