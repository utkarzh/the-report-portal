'use client'

import { useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import type { ResearchProvider } from '@/types'

export interface ResearchEngineOption {
  value: ResearchProvider
  label: string
  description: string
}

interface Props {
  // PATCHed with { researchProvider }.
  endpoint: string
  options: ResearchEngineOption[]
  initialProvider: ResearchProvider
  geminiConfigured: boolean
  // Shown when Gemini is chosen but GEMINI_API_KEY isn't set.
  missingKeyNote: string
  // Set when the setting can't be saved yet (e.g. its migration hasn't run).
  disabledReason?: string | null
}

// The research-engine picker shared by the Interview Tool and Interview
// Letters admin pages.
export default function ResearchEngineSelector({
  endpoint,
  options,
  initialProvider,
  geminiConfigured,
  missingKeyNote,
  disabledReason,
}: Props) {
  const [provider, setProvider] = useState(initialProvider)
  const [saving, setSaving] = useState<ResearchProvider | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(value: ResearchProvider) {
    if (value === provider || saving || disabledReason) return
    setSaving(value)
    setSaved(false)
    setError(null)
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ researchProvider: value }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setSaving(null)
    if (!res?.ok) {
      setError(data.error || 'Failed to save.')
      return
    }
    setProvider(value)
    setSaved(true)
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      {options.map((o) => {
        const active = o.value === provider
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => choose(o.value)}
            disabled={Boolean(saving) || Boolean(disabledReason)}
            className={`flex items-start gap-3 border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed ${
              active ? 'border-black bg-[#faf9f7]' : 'border-[#e5e3df] hover:border-gray-400'
            } ${disabledReason ? 'opacity-60' : ''}`}
          >
            <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${active ? 'border-black bg-black text-white' : 'border-gray-300'}`}>
              {saving === o.value ? <Loader2 size={10} className="animate-spin text-gray-500" /> : active ? <Check size={10} /> : null}
            </span>
            <span>
              <span className="block text-sm font-medium text-gray-900">{o.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{o.description}</span>
            </span>
          </button>
        )
      })}
      {disabledReason && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {disabledReason}
        </p>
      )}
      {!disabledReason && provider === 'gemini' && !geminiConfigured && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {missingKeyNote}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && !error && <p className="text-xs text-emerald-700">Saved. New research runs use this engine.</p>}
    </div>
  )
}
