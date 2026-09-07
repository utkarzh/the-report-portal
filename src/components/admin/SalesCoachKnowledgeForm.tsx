'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import PromptVersionHistory from '@/components/admin/PromptVersionHistory'
import type { SalesCoachKnowledgeKey } from '@/types'

interface Props {
  docKey: SalesCoachKnowledgeKey
  label: string
  initialContent: string
}

// Editor for one of the four Sales Coach knowledge documents (US-046). Mirrors
// the interview-letter research prompt form: save snapshots the previous
// version first, and the shared history panel offers full rollback (US-048).
export default function SalesCoachKnowledgeForm({ docKey, label, initialContent }: Props) {
  const router = useRouter()
  const [content, setContent] = useState(initialContent)
  const [savedText, setSavedText] = useState(initialContent)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [versionRefreshKey, setVersionRefreshKey] = useState(0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (content === savedText) {
      setSuccess(true)
      return
    }
    setError(null)
    setSuccess(false)
    setLoading(true)

    const res = await fetch(`/api/sales-coach/knowledge/${docKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptText: content }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to save document.')
    } else {
      setSavedText(content)
      setSuccess(true)
      setVersionRefreshKey((k) => k + 1)
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
          Saved. New coaching conversations and Report Cards will use this version of the {label}.
        </div>
      )}

      <div className="bg-white border border-[#e5e3df]">
        <div className="p-5 sm:p-6">
          <Textarea
            label={label}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={28}
            className="font-mono text-xs"
          />
        </div>
        <div className="px-5 sm:px-6 py-4 border-t border-[#e5e3df] bg-gray-50 flex items-center justify-between gap-4">
          <span className="text-xs text-gray-400">{content.length.toLocaleString()} characters</span>
          <Button type="submit" loading={loading} arrow size="sm">
            Save Document
          </Button>
        </div>
      </div>

      <PromptVersionHistory
        type="sales_coach_knowledge"
        docKey={docKey}
        currentPromptText={content}
        refreshKey={versionRefreshKey}
        onRestore={(text) => {
          setContent(text)
          setSavedText(text)
          setSuccess(false)
          setError(null)
          setVersionRefreshKey((k) => k + 1)
          router.refresh()
        }}
      />
    </form>
  )
}
