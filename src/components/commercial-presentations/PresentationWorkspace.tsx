'use client'

import { useCallback, useState } from 'react'
import StatusPill from '@/components/ui/StatusPill'
import { API_PATH, presentationStatus } from '@/lib/commercial-presentations'
import type { WorkspaceState } from '@/lib/commercial-presentations-state'
import SourcesPanel from './SourcesPanel'
import InputsPanel from './InputsPanel'
import WhyNowPanel from './WhyNowPanel'
import ReviewPanel from './ReviewPanel'
import HistoryPanel from './HistoryPanel'
import { Notice } from './ui'

// The Commercial Presentation workspace. One page, five steps in the brief's
// order (§25): project intelligence → inputs → Why [Country] Now → review &
// approval → history. Every mutation returns the full workspace state from
// the server, so the page can never drift from what's saved.

export interface WorkspaceApi {
  state: WorkspaceState
  /** Calls a JSON endpoint that returns the workspace state, and applies it. */
  mutate: (path: string, method: 'POST' | 'PATCH', body?: unknown) => Promise<boolean>
  refresh: () => Promise<void>
  setError: (message: string | null) => void
}

export default function PresentationWorkspace({ initial, currentUserName }: { initial: WorkspaceState; currentUserName: string }) {
  const [state, setState] = useState<WorkspaceState>(initial)
  const [error, setError] = useState<string | null>(null)
  const id = state.presentation.id

  const refresh = useCallback(async () => {
    const res = await fetch(`${API_PATH}/${id}`, { cache: 'no-store' })
    if (res.ok) setState(await res.json())
  }, [id])

  const mutate = useCallback(
    async (path: string, method: 'POST' | 'PATCH', body?: unknown) => {
      setError(null)
      const res = await fetch(`${API_PATH}/${id}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Something went wrong. Please try again.')
        // 409 = someone else submitted, approved, returned or reopened it
        // meanwhile: show its current state instead of the stale one.
        if (res.status === 409) await refresh()
        return false
      }
      setState(data as WorkspaceState)
      return true
    },
    [id, refresh],
  )

  const api: WorkspaceApi = { state, mutate, refresh, setError }
  const status = presentationStatus(state.presentation)
  const { project } = state

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">{project.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {[project.agency_name, `${project.media_name}${state.mediaMarket ? ` (${state.mediaMarket})` : ''}`, project.country, project.edition]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {project.anchor_event && <p className="mt-1 text-xs text-gray-500">Anchor event: {project.anchor_event}{project.anchor_date ? ` — ${project.anchor_date}` : ''}</p>}
        </div>
        <StatusPill label={status.label} tone={status.tone} pulse={state.presentation.status === 'submitted'} />
      </header>

      {error && <Notice tone="error">{error}</Notice>}

      {state.presentation.status === 'draft' && state.presentation.review_comment && (
        <Notice tone="warn">
          <span className="font-semibold">Returned for changes:</span> {state.presentation.review_comment}
        </Notice>
      )}
      {state.presentation.status === 'draft' && state.approvedSnapshot && (
        <Notice tone="info">
          A revision is in progress. Approved version {state.approvedSnapshot.version_number} stays in use until this revision is approved.
        </Notice>
      )}
      {state.presentation.status === 'approved' && state.masterOutdated && (
        <Notice tone="warn">
          <span className="font-semibold">New Master Content Available.</span> An admin has updated wording this presentation uses. The approved version is unchanged; reopen it to use the new content (it will need approval again).
        </Notice>
      )}
      {state.permissions.editBlockedReason && state.presentation.status !== 'approved' && (
        <Notice tone="info">{state.permissions.editBlockedReason}</Notice>
      )}

      <SourcesPanel api={api} currentUserName={currentUserName} />
      <InputsPanel api={api} />
      <WhyNowPanel api={api} />
      <ReviewPanel api={api} />
      <HistoryPanel api={api} />
    </div>
  )
}
