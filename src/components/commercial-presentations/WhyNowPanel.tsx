'use client'

import { useState } from 'react'
import { AlertTriangle, Check, Pencil, RefreshCw, Shuffle, Sparkles } from 'lucide-react'
import { API_PATH, spokenSeconds, wordCount } from '@/lib/commercial-presentations'
import { postSse } from '@/lib/sse-client'
import type { WorkspaceApi } from './PresentationWorkspace'
import { Card, CardHeader, Notice, PrimaryButton, SecondaryButton, inputClass } from './ui'

// Step 3 — Why [Country] Now (brief §11–14, §19). The only AI-written block.
// Generate / Regenerate / Generate Alternative / Edit / Return to Previous
// Version / Select Preferred Version — every one is a saved version, so the
// team can experiment freely without losing anything.

const KIND_LABEL = { generate: 'Generated', alternative: 'Alternative', edit: 'Edited' } as const

const STATUS_TEXT: Record<string, string> = {
  researching: 'Checking for recent developments…',
  web_search: 'Searching the web for recent developments…',
  writing: 'Writing the Why Now argument…',
  revising: 'Tightening it to the length and style rules…',
}

export default function WhyNowPanel({ api }: { api: WorkspaceApi }) {
  const { state, refresh, mutate, setError } = api
  const { versions, presentation, permissions, whyNowRules, project } = state
  const canEdit = permissions.canEdit
  const selected = versions.find((v) => v.id === presentation.selected_why_now_id) || null

  const [running, setRunning] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const checkRecent = presentation.why_now_inputs.checkRecent === true

  async function generate(mode: 'generate' | 'alternative') {
    setError(null)
    setWarnings([])
    setRunning('Starting…')
    try {
      const result = await postSse<{ warnings?: string[] }>(`${API_PATH}/${presentation.id}/why-now`, { mode, checkRecent }, (p) => {
        if (typeof p.status === 'string') setRunning(STATUS_TEXT[p.status] || 'Working…')
      })
      setWarnings(result.warnings || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setRunning(null)
      await refresh()
    }
  }

  const draftWords = wordCount(draft)

  return (
    <Card>
      <CardHeader
        step="Step 3"
        title={`Why ${project.country} Now`}
        description={`About ${Math.round((whyNowRules.minWords / whyNowRules.wordsPerMinute) * 60)}–${Math.round((whyNowRules.maxWords / whyNowRules.wordsPerMinute) * 60)} seconds of natural speech with the 2–4 strongest editorial reasons. Generate, regenerate and compare as many versions as you like — no approval needed until you submit.`}
        action={
          canEdit &&
          !running && (
            <>
              <PrimaryButton icon={selected ? <RefreshCw size={14} /> : <Sparkles size={14} />} onClick={() => generate('generate')}>
                {selected ? 'Regenerate' : 'Generate'}
              </PrimaryButton>
              {versions.length > 0 && (
                <SecondaryButton icon={<Shuffle size={14} />} onClick={() => generate('alternative')}>
                  Generate alternative
                </SecondaryButton>
              )}
            </>
          )
        }
      />

      {canEdit && (
        <label className="mb-4 flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={checkRecent}
            disabled={Boolean(running)}
            onChange={(e) => mutate('', 'PATCH', { whyNowInputs: { checkRecent: e.target.checked } })}
          />
          <span>
            Check for recent developments
            <span className="block text-xs text-gray-500">
              Lets the AI search the web (up to {whyNowRules.maxWebSearches} searches). Any new fact it uses is listed separately for review.
            </span>
          </span>
        </label>
      )}

      {running && <Notice tone="info">{running}</Notice>}
      {warnings.length > 0 && !running && (
        <div className="mt-3">
          <Notice tone="warn">
            <span className="font-semibold">Check before using:</span> {warnings.join(' ')}
          </Notice>
        </div>
      )}

      {selected ? (
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-700">
              Selected version · {KIND_LABEL[selected.kind]} · {selected.words} words · ~{selected.seconds}s
            </p>
            {canEdit && !editing && !running && (
              <SecondaryButton
                icon={<Pencil size={13} />}
                onClick={() => {
                  setDraft(selected.spoken_text)
                  setEditing(true)
                }}
              >
                Edit
              </SecondaryButton>
            )}
          </div>
          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea rows={8} className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <p className="text-[11px] text-gray-500">
                {draftWords} words · ~{spokenSeconds(draft, whyNowRules.wordsPerMinute)}s spoken. Saving keeps the original as an earlier version.
              </p>
              <div className="flex gap-2">
                <PrimaryButton
                  disabled={!draft.trim() || draft.trim() === selected.spoken_text.trim()}
                  onClick={async () => {
                    if (await mutate('/why-now/edit', 'POST', { text: draft, baseVersionId: selected.id })) setEditing(false)
                  }}
                >
                  Save as new version
                </PrimaryButton>
                <SecondaryButton onClick={() => setEditing(false)}>Cancel</SecondaryButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm leading-relaxed text-gray-900">
              {selected.spoken_text.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}
          {selected.new_external_facts.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <AlertTriangle size={13} /> New external facts requiring review
              </p>
              <ul className="flex flex-col gap-1 text-xs text-amber-900">
                {selected.new_external_facts.map((f, i) => (
                  <li key={i}>
                    • {f.fact}
                    {f.source && (
                      <>
                        {' — '}
                        <a href={f.source} target="_blank" rel="noreferrer" className="underline">
                          source
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        !running && <p className="mt-2 text-sm text-gray-500">No version yet. Attach or generate the project intelligence above, then press Generate.</p>
      )}

      {versions.length > 1 && (
        <div className="mt-5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">All versions ({versions.length})</p>
          <ul className="flex flex-col divide-y divide-[#efede9] rounded-xl border border-[#e5e3df]">
            {versions.map((v, i) => {
              const isSelected = v.id === selected?.id
              return (
                <li key={v.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" className="min-w-0 text-left" onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                      <span className="text-sm font-medium text-gray-800">
                        Version {versions.length - i} · {KIND_LABEL[v.kind]}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {[new Date(v.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), v.createdByName, `${v.words} words`, v.research_used ? 'with web check' : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                    {isSelected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-medium text-violet-700">
                        <Check size={11} /> In use
                      </span>
                    ) : (
                      canEdit && (
                        <SecondaryButton disabled={Boolean(running)} onClick={() => mutate('/why-now/select', 'POST', { versionId: v.id })}>
                          Use this version
                        </SecondaryButton>
                      )
                    )}
                  </div>
                  {expanded === v.id && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">{v.spoken_text}</p>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Card>
  )
}
