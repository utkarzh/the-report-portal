'use client'

import { useState, useCallback, useEffect } from 'react'
import type { PromptVersion, CategoryPromptVersion } from '@/types'

type Version = PromptVersion | CategoryPromptVersion

interface Props {
  type: 'general' | 'category'
  categoryId?: string
  currentPromptText?: string
  refreshKey?: number
  onRestore: (promptText: string) => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function PromptVersionHistory({ type, categoryId, currentPromptText, refreshKey, onRestore }: Props) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Version | 'current' | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchVersions = useCallback(async () => {
    setLoading(true)
    setError(null)
    const url = type === 'general'
      ? '/api/prompts/versions'
      : `/api/categories/${categoryId}/versions`
    const res = await fetch(url)
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to load versions')
    } else {
      setVersions(data.versions || [])
    }
    setLoading(false)
  }, [type, categoryId])

  useEffect(() => {
    if (open && refreshKey !== undefined && refreshKey > 0) {
      setSelected(null)
      fetchVersions()
    }
  }, [refreshKey])

  function handleToggle() {
    if (!open) fetchVersions()
    setOpen(v => !v)
    setSelected(null)
  }

  async function handleRestore() {
    if (!selected || selected === 'current') return
    setRestoring(true)
    setError(null)

    const url = type === 'general'
      ? `/api/prompts/versions/${selected.id}`
      : `/api/categories/${categoryId}/versions/${selected.id}`

    const res = await fetch(url, { method: 'POST' })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Failed to restore version')
    } else {
      onRestore(data.promptText)
      setSelected('current')
      fetchVersions()
    }
    setRestoring(false)
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    setError(null)
    const url = type === 'general'
      ? `/api/prompts/versions/${id}`
      : `/api/categories/${categoryId}/versions/${id}`
    const res = await fetch(url, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to delete version')
    } else {
      if ((selected as Version)?.id === id) setSelected(null)
      setVersions(prev => prev.filter(v => v.id !== id))
    }
    setDeletingId(null)
    setConfirmDeleteId(null)
  }

  const previewText = selected === 'current'
    ? currentPromptText
    : selected?.prompt_text

  return (
    <div className="border border-[#e5e3df] bg-white">
      {/* Toggle header */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-xs font-medium tracking-wider uppercase text-gray-600 hover:text-black hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Version History
          {versions.length > 0 && (
            <span className="text-[10px] font-normal normal-case text-gray-400 ml-0.5">
              ({versions.length} saved)
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[#e5e3df]">
          {error && (
            <div className="px-5 py-3 text-sm text-red-600 bg-red-50 border-b border-[#e5e3df]">
              {error}
            </div>
          )}

          {loading ? (
            <div className="px-6 py-10 text-sm text-gray-400">Loading versions…</div>
          ) : (
            /* Split panel — stacks on mobile, side-by-side on md+ */
            <div className="flex flex-col md:flex-row md:divide-x divide-[#e5e3df]" style={{ minHeight: '600px' }}>

              {/* Version list */}
              <div className="md:w-80 flex-shrink-0 overflow-y-auto border-b md:border-b-0 border-[#e5e3df] max-h-56 md:max-h-none">

                  {/* Current version */}
                  {currentPromptText !== undefined && (
                    <button
                      type="button"
                      onClick={() => setSelected('current')}
                      className={`w-full text-left px-5 py-4 border-b border-[#e5e3df] transition-colors ${
                        selected === 'current' ? 'bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-800">Current</span>
                        <span className="text-[9px] font-semibold uppercase tracking-wider bg-black text-white px-1.5 py-0.5">
                          Active
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 leading-relaxed line-clamp-2">
                        {currentPromptText.slice(0, 100)}
                        {currentPromptText.length > 100 ? '…' : ''}
                      </div>
                    </button>
                  )}

                  {versions.length === 0 ? (
                    <div className="px-5 py-6 text-sm text-gray-400 leading-relaxed">
                      No previous versions. Save the prompt to start tracking history.
                    </div>
                  ) : (
                    versions.map((v, i) => (
                      <div
                        key={v.id}
                        className={`group relative border-b border-[#e5e3df] transition-colors ${
                          selected !== 'current' && (selected as Version)?.id === v.id
                            ? 'bg-gray-100'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelected(v)}
                          className="w-full text-left px-5 py-4 pr-12"
                        >
                          <div className="text-sm font-medium text-gray-800 mb-0.5">
                            Version {versions.length - i}
                          </div>
                          <div className="text-xs text-gray-500">{formatDate(v.created_at)}</div>
                          {v.saved_by_email && (
                            <div className="text-xs text-gray-400 mt-0.5 truncate">{v.saved_by_email}</div>
                          )}
                        </button>

                        {/* Delete controls */}
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {confirmDeleteId === v.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDelete(v.id)}
                                disabled={deletingId === v.id}
                                className="text-[9px] font-semibold uppercase tracking-wider bg-red-600 text-white px-2 py-1 hover:bg-red-700 disabled:opacity-50 transition-colors"
                              >
                                {deletingId === v.id ? '…' : 'Yes'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-[9px] font-semibold uppercase tracking-wider bg-gray-200 text-gray-600 px-2 py-1 hover:bg-gray-300 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(v.id) }}
                              className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-300 hover:text-red-500 transition-all"
                              title="Delete version"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}

              </div>

              {/* Preview pane */}
              <div className="flex-1 flex flex-col min-w-0 min-h-0">
                {previewText !== undefined && previewText !== null ? (
                  <>
                    {/* Pane toolbar */}
                    <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-[#e5e3df] bg-gray-50 flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 uppercase tracking-wider">
                          {selected === 'current' ? 'Current active prompt' : 'Saved version preview'}
                        </span>
                        {previewText && (
                          <span className="text-xs text-gray-400">
                            {previewText.length.toLocaleString()} chars
                          </span>
                        )}
                      </div>
                      {selected !== 'current' && selected !== null && (
                        <button
                          type="button"
                          onClick={handleRestore}
                          disabled={restoring}
                          className="text-xs font-medium tracking-wider uppercase bg-black text-white px-4 py-2 hover:bg-gray-900 disabled:opacity-50 transition-colors flex-shrink-0"
                        >
                          {restoring ? 'Restoring…' : 'Restore this version'}
                        </button>
                      )}
                    </div>

                    {/* Scrollable prompt text */}
                    <pre className="flex-1 p-5 sm:p-6 text-sm text-gray-700 font-mono whitespace-pre-wrap overflow-y-auto leading-relaxed" style={{ minHeight: '400px' }}>
                      {previewText}
                    </pre>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-8">
                    <div className="text-center">
                      <svg className="w-8 h-8 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Select a version to preview its content
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  )
}
