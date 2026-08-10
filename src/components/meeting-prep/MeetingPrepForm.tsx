'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import { INTERVIEW_TYPES } from '@/lib/meeting-prep'
import type { MeetingPrepMediaLibraryEntry } from '@/types'

interface Props {
  mediaLibrary: MeetingPrepMediaLibraryEntry[]
  isAtLimit: boolean
}

export default function MeetingPrepForm({ mediaLibrary, isAtLimit }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    intervieweeName: '',
    intervieweeTitle: '',
    intervieweeType: '',
    companyOrg: '',
    companyCountry: '',
    publication: '',
    publicationCountry: '',
    advertiserHistoryStatus: '',
    advertiserHistoryDetails: '',
  })

  function handleChange(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const publicationOptions = mediaLibrary.map(m => ({ value: m.publication_name, label: m.publication_name }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isAtLimit) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/meeting-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to start meeting preparation. Please try again.')
        setLoading(false)
        return
      }
      const { id } = await res.json()
      router.push(`/meeting-preparation/${id}?generating=true`)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
      )}

      {mediaLibrary.length === 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-xs text-amber-700">
          No publications are set up yet. Ask an admin to add one in the Meeting Preparation admin area
          before starting a meeting prep.
        </div>
      )}

      <Input
        label="Interviewee Name *"
        placeholder="e.g. Jane Doe"
        value={form.intervieweeName}
        onChange={(e) => handleChange('intervieweeName', e.target.value)}
        required
      />

      <Input
        label="Interviewee Title / Position *"
        placeholder="e.g. Chief Executive Officer"
        value={form.intervieweeTitle}
        onChange={(e) => handleChange('intervieweeTitle', e.target.value)}
        required
      />

      <Select
        label="Interviewee Type *"
        options={INTERVIEW_TYPES.map(t => ({ value: t.value, label: t.label }))}
        value={form.intervieweeType}
        onChange={(e) => handleChange('intervieweeType', e.target.value)}
        required
      />

      <Input
        label="Company / Organisation *"
        placeholder="e.g. Acme Corp"
        value={form.companyOrg}
        onChange={(e) => handleChange('companyOrg', e.target.value)}
        required
      />

      <Input
        label="Country of the Company *"
        placeholder="e.g. Brazil"
        value={form.companyCountry}
        onChange={(e) => handleChange('companyCountry', e.target.value)}
        required
      />

      <Select
        label="Publication *"
        options={publicationOptions}
        value={form.publication}
        onChange={(e) => handleChange('publication', e.target.value)}
        required
        disabled={mediaLibrary.length === 0}
      />

      <Input
        label="Country of Publication *"
        placeholder="e.g. United Kingdom"
        value={form.publicationCountry}
        onChange={(e) => handleChange('publicationCountry', e.target.value)}
        required
      />

      <div className="pt-2 border-t border-[#e5e3df]" />

      <Select
        label="Has this company previously advertised with TRC? *"
        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
        value={form.advertiserHistoryStatus}
        onChange={(e) => handleChange('advertiserHistoryStatus', e.target.value)}
        required
      />

      {form.advertiserHistoryStatus === 'yes' && (
        <Textarea
          label="Advertiser History Details *"
          placeholder="Publication, advertising space and approximate period."
          value={form.advertiserHistoryDetails}
          onChange={(e) => handleChange('advertiserHistoryDetails', e.target.value)}
          rows={3}
          required
        />
      )}

      <div className="pt-2">
        <Button type="submit" loading={loading} disabled={isAtLimit || mediaLibrary.length === 0} arrow>
          Start Research
        </Button>
      </div>
    </form>
  )
}
