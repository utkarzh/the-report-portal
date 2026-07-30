'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import { getDocConfig } from '@/lib/documents'
import type { DocType } from '@/types'

interface Props {
  docType: DocType
  isAtLimit: boolean
}

// Create form for a document module. All three inputs are optional, plus an
// optional Additional Context box. Mirrors ResearchForm: only creates the row,
// then navigates — the output page opens the actual generation stream.
export default function DocumentForm({ docType, isAtLimit }: Props) {
  const router = useRouter()
  const config = getDocConfig(docType)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    projectCountry: '',
    mediaPartner: '',
    mediaCountry: '',
    additionalContext: '',
  })

  function handleChange(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isAtLimit) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, ...form }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 402) {
          setError('Token limit reached. Contact an admin to increase your limit.')
        } else if (res.status === 422) {
          // Sanity gate rejected the inputs — show its explanation verbatim.
          setError(data.error || 'Please check the details above and try again.')
        } else {
          setError(data.error || 'Failed to start generation. Please try again.')
        }
        setLoading(false)
        return
      }
      const { id } = await res.json()
      router.push(`/${config.slug}/${id}?generating=true`)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      <Input
        label="Project Country"
        hint="optional"
        placeholder="e.g. Nigeria"
        value={form.projectCountry}
        onChange={(e) => handleChange('projectCountry', e.target.value)}
      />

      <Input
        label="Media Partner"
        hint="optional"
        placeholder="e.g. USA Today"
        value={form.mediaPartner}
        onChange={(e) => handleChange('mediaPartner', e.target.value)}
      />

      <Input
        label="Media Country"
        hint="optional"
        placeholder="e.g. USA"
        value={form.mediaCountry}
        onChange={(e) => handleChange('mediaCountry', e.target.value)}
      />

      <Textarea
        label="Additional Context"
        hint="optional"
        placeholder="Anything else the AI should know or focus on for this document."
        value={form.additionalContext}
        onChange={(e) => handleChange('additionalContext', e.target.value)}
        rows={4}
      />

      <div className="pt-2">
        <Button type="submit" loading={loading} disabled={isAtLimit} arrow>
          Generate {config.label}
        </Button>
      </div>
    </form>
  )
}
