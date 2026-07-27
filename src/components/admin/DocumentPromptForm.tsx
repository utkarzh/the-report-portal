'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import PromptVersionHistory from '@/components/admin/PromptVersionHistory'
import type { DocType } from '@/types'

interface Props {
  docType: DocType
  label: string
  initialPrompt: string
}

// Detailed "source of truth" prompt editor for a document module (Business
// Cases / Editorial Briefs). Mirrors TranscriptPromptForm, keyed by docType.
export default function DocumentPromptForm({ docType, label, initialPrompt }: Props) {
  const router = useRouter()
  const [promptText, setPromptText] = useState(initialPrompt)
  const [savedText, setSavedText] = useState(initialPrompt)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [versionRefreshKey, setVersionRefreshKey] = useState(0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (promptText === savedText) {
      setSuccess(true)
      return
    }
    setError(null)
    setSuccess(false)
    setLoading(true)

    const res = await fetch('/api/document-prompt', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType, promptText }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to save prompt.')
    } else {
      setSavedText(promptText)
      setSuccess(true)
      setVersionRefreshKey(k => k + 1)
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          Prompt saved. All future {label.toLowerCase()} generations will use this prompt as the highest-priority instruction.
        </div>
      )}

      <div className="bg-white border border-[#e5e3df]">
        <div className="p-5 sm:p-6">
          <Textarea
            label={`${label} Prompt`}
            placeholder={`Define exactly how the AI should produce a ${label.toLowerCase()} — structure, depth, tone, and any non-negotiable rules...`}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={24}
            className="font-mono text-xs"
          />
        </div>
        <div className="px-5 sm:px-6 py-4 border-t border-[#e5e3df] bg-gray-50 flex items-center justify-between gap-4">
          <span className="text-xs text-gray-400">{promptText.length.toLocaleString()} characters</span>
          <Button type="submit" loading={loading} arrow size="sm">
            Save Prompt
          </Button>
        </div>
      </div>

      <PromptVersionHistory
        type="document"
        docType={docType}
        currentPromptText={promptText}
        refreshKey={versionRefreshKey}
        onRestore={(text) => {
          setPromptText(text)
          setSavedText(text)
          setSuccess(false)
          setError(null)
          setVersionRefreshKey(k => k + 1)
          router.refresh()
        }}
      />
    </form>
  )
}
