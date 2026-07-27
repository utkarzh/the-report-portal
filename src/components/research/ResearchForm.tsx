'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Select from '@/components/ui/Select'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import ResearchDocPicker from '@/components/research/ResearchDocPicker'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { RESEARCH_DOCS_BUCKET } from '@/lib/research-docs'
import type { Category } from '@/types'

interface ResearchFormProps {
  categories: Category[]
  isAtLimit: boolean
  userId: string
}

export default function ResearchForm({ categories, isAtLimit, userId }: ResearchFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docs, setDocs] = useState<File[]>([])
  const [docError, setDocError] = useState<string | null>(null)

  const [form, setForm] = useState({
    categoryId: '',
    fullName: '',
    titlePosition: '',
    companyOrg: '',
    countryFocus: '',
    publication: '',
    mediaPartnerCountry: '',
  })
  const [additionalPrompt, setAdditionalPrompt] = useState('')

  function handleChange(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isAtLimit) return
    setError(null)
    setLoading(true)

    try {
      // Only create the session record — no Claude call yet.
      // The session page starts the actual stream so we never abandon a live connection.
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 402) {
          setError('Token limit reached. Contact an admin to increase your limit.')
        } else {
          setError(data.error || 'Failed to start research. Please try again.')
        }
        setLoading(false)
        return
      }

      const { id: sessionId } = await res.json()

      // Upload any attached company documents now that we have a session id.
      // Each is uploaded to the private bucket, then recorded (+ text extracted
      // server-side) so /api/generate can use it as context. Must complete
      // BEFORE navigation — the session page auto-starts generation on mount.
      if (docs.length > 0) {
        const supabase = getSupabaseBrowserClient()
        for (const file of docs) {
          const ext = file.name.split('.').pop() || 'bin'
          const storagePath = `${userId}/${sessionId}/${crypto.randomUUID()}.${ext}`
          const { error: upErr } = await supabase
            .storage
            .from(RESEARCH_DOCS_BUCKET)
            .upload(storagePath, file, {
              contentType: file.type || 'application/octet-stream',
              upsert: false,
            })
          if (upErr) {
            setError(`Couldn't upload "${file.name}". Please remove it and try again.`)
            setLoading(false)
            return
          }
          const recRes = await fetch(`/api/sessions/${sessionId}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storagePath,
              filename: file.name,
              mime: file.type || null,
              sizeBytes: file.size,
            }),
          })
          if (!recRes.ok) {
            const d = await recRes.json().catch(() => ({}))
            setError(d.error || `Couldn't process "${file.name}". Please try a different file.`)
            setLoading(false)
            return
          }
        }
      }

      // Hand off the (ephemeral) additional prompt to the output page via
      // sessionStorage — it gets sent to /api/generate once and is not persisted.
      const trimmed = additionalPrompt.trim()
      if (trimmed && typeof window !== 'undefined') {
        sessionStorage.setItem(`research-extra:${sessionId}`, trimmed)
      }

      router.push(`/research/${sessionId}?generating=true`)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  const categoryOptions = categories.map(c => ({ value: c.id, label: c.name }))

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      <Select
        label="Interviewee Type *"
        placeholder="Select a type..."
        options={categoryOptions}
        value={form.categoryId}
        onChange={(e) => handleChange('categoryId', e.target.value)}
        required
      />

      <Input
        label="Full Name *"
        placeholder="e.g. Temitope Runsewe"
        value={form.fullName}
        onChange={(e) => handleChange('fullName', e.target.value)}
        required
      />

      <Input
        label="Title / Position *"
        placeholder="e.g. Chief Executive Officer"
        value={form.titlePosition}
        onChange={(e) => handleChange('titlePosition', e.target.value)}
        required
      />

      <Input
        label="Company / Organization / Ministry *"
        placeholder="e.g. Dutum Company Limited"
        value={form.companyOrg}
        onChange={(e) => handleChange('companyOrg', e.target.value)}
        required
      />

      <Input
        label="Country in Focus *"
        placeholder="e.g. Nigeria"
        value={form.countryFocus}
        onChange={(e) => handleChange('countryFocus', e.target.value)}
        required
      />

      <Input
        label="Publication *"
        placeholder="e.g. USA Today"
        value={form.publication}
        onChange={(e) => handleChange('publication', e.target.value)}
        required
      />

      <Input
        label="Media Partner Country *"
        placeholder="e.g. USA"
        value={form.mediaPartnerCountry}
        onChange={(e) => handleChange('mediaPartnerCountry', e.target.value)}
        required
      />

      <Textarea
        label="Additional Context"
        hint="optional"
        placeholder="Anything specific the AI should focus on for this research run? Not saved."
        value={additionalPrompt}
        onChange={(e) => setAdditionalPrompt(e.target.value)}
        rows={3}
      />

      <ResearchDocPicker
        files={docs}
        onChange={setDocs}
        disabled={loading}
        error={docError}
        onError={setDocError}
      />

      <div className="pt-2">
        <Button type="submit" loading={loading} disabled={isAtLimit} arrow>
          Start Research
        </Button>
      </div>
    </form>
  )
}
