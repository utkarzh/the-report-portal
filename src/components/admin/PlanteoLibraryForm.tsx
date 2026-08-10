'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import PromptVersionHistory from '@/components/admin/PromptVersionHistory'
import type { InterviewType } from '@/types'

interface Props {
  variant: InterviewType
  label: string
  initialTemplateText: string
}

export default function PlanteoLibraryForm({ variant, label, initialTemplateText }: Props) {
  const router = useRouter()
  const [templateText, setTemplateText] = useState(initialTemplateText)
  const [savedText, setSavedText] = useState(initialTemplateText)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [versionRefreshKey, setVersionRefreshKey] = useState(0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (templateText === savedText) {
      setSuccess(true)
      return
    }
    setError(null)
    setSuccess(false)
    setLoading(true)

    const res = await fetch(`/api/meeting-prep/planteo-library/${variant}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateText }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to save planteo formula.')
    } else {
      setSavedText(templateText)
      setSuccess(true)
      setVersionRefreshKey(k => k + 1)
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          Planteo formula saved. Every future {label.toLowerCase()} planteo will build on this exact structure.
        </div>
      )}

      <div className="bg-white border border-[#e5e3df]">
        <div className="p-5 sm:p-6">
          <Textarea
            label={`${label} Planteo Formula`}
            placeholder="Paste the approved TRC planteo build-up script for this variant. Annotate which sections are fixed (locked) and which accept variable content from the research, motivation profiles and presentation points."
            value={templateText}
            onChange={(e) => setTemplateText(e.target.value)}
            rows={24}
            className="font-mono text-xs"
          />
          <p className="text-xs text-gray-400 mt-2 leading-relaxed">
            This is the source of truth the Planteo Prompt must follow — the AI may not improvise structure
            outside it. Every save is versioned and logged.
          </p>
        </div>
        <div className="px-5 sm:px-6 py-4 border-t border-[#e5e3df] bg-gray-50 flex items-center justify-between gap-4">
          <span className="text-xs text-gray-400">{templateText.length.toLocaleString()} characters</span>
          <Button type="submit" loading={loading} arrow size="sm">
            Save Formula
          </Button>
        </div>
      </div>

      <PromptVersionHistory
        type="meeting_prep_planteo"
        variant={variant}
        currentPromptText={templateText}
        refreshKey={versionRefreshKey}
        onRestore={(text) => {
          setTemplateText(text)
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
