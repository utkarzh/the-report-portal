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

  // Re-fetch when parent signals a save happened (refreshKey changes)
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
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-5 py-3 text-xs font-medium tracking-wider uppercase text-gray-600 hover:text-black hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Version History
          {versions.length > 0 && (
            <span className="text-[10px] font-normal normal-case text-gray-400">({versions.length} saved)</span>
          )}
        </span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[#e5e3df]">
          {error && (
            <div className="px-5 py-3 text-xs text-red-600 bg-red-50 border-b border-[#e5e3df]">{error}</div>
          )}

          {loading ? (
            <div className="px-5 py-4 text-xs text-gray-400">Loading versions...</div>
          ) : (
            <div className="flex divide-x divide-[#e5e3df]" style={{ minHeight: '260px' }}>
              {/* Version list */}
              <div className="w-64 flex-shrink-0 overflow-y-auto" style={{ maxHeight: '400px' }}>
                {/* Current version entry */}
                {currentPromptText !== undefined && (
                  <button
                    type="button"
                    onClick={() => setSelected('current')}
                    className={`w-full text-left px-4 py-3 border-b border-[#e5e3df] transition-colors ${
                      selected === 'current' ? 'bg-gray-100' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium text-gray-800">Current</div>
                      <span className="text-[9px] font-semibold uppercase tracking-wider bg-black text-white px-1.5 py-0.5">
                        Active
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5 truncate">
                      {currentPromptText.slice(0, 60)}…
                    </div>
                  </button>
                )}

                {versions.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-gray-400">
                    No previous versions. Save the prompt to start tracking history.
                  </div>
                ) : (
                  versions.map((v, i) => (
                    <div
                      key={v.id}
                      className={`group relative border-b border-[#e5e3df] transition-colors ${
                        selected !== 'current' && (selected as Version)?.id === v.id ? 'bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelected(v)}
                        className="w-full text-left px-4 py-3 pr-8"
                      >
                        <div className="text-xs font-medium text-gray-800">
                          Version {versions.length - i}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{formatDate(v.created_at)}</div>
                        {v.saved_by_email && (
                          <div className="text-[10px] text-gray-400 truncate">{v.saved_by_email}</div>
                        )}
                      </button>

                      {/* Delete controls — appear on hover */}
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        {confirmDeleteId === v.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleDelete(v.id)}
                              disabled={deletingId === v.id}
                              className="text-[9px] font-semibold uppercase tracking-wider bg-red-600 text-white px-1.5 py-1 hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                              {deletingId === v.id ? '…' : 'Yes'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[9px] font-semibold uppercase tracking-wider bg-gray-200 text-gray-600 px-1.5 py-1 hover:bg-gray-300 transition-colors"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(v.id) }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all"
                            title="Delete version"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              <div className="flex-1 flex flex-col min-w-0">
                {previewText !== undefined && previewText !== null ? (
                  <>
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e5e3df] bg-gray-50">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                        {selected === 'current' ? 'Current active prompt' : 'Preview'}
                      </span>
                      {selected !== 'current' && selected !== null && (
                        <button
                          type="button"
                          onClick={handleRestore}
                          disabled={restoring}
                          className="text-[10px] font-medium tracking-wider uppercase bg-black text-white px-3 py-1.5 hover:bg-gray-900 disabled:opacity-50 transition-colors"
                        >
                          {restoring ? 'Restoring...' : 'Restore this version'}
                        </button>
                      )}
                    </div>
                    <pre className="flex-1 p-4 text-[11px] text-gray-700 font-mono whitespace-pre-wrap overflow-y-auto leading-relaxed" style={{ maxHeight: '340px' }}>
                      {previewText}
                    </pre>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-gray-400 p-6">
                    Select a version to preview
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
