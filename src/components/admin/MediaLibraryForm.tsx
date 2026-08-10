'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import type { MeetingPrepMediaLibraryEntry } from '@/types'

interface Props {
  entry?: MeetingPrepMediaLibraryEntry
}

export default function MediaLibraryForm({ entry }: Props) {
  const router = useRouter()
  const isEdit = !!entry

  const [form, setForm] = useState({
    publicationName: entry?.publication_name || '',
    positioningStatement: entry?.positioning_statement || '',
    audienceReach: entry?.audience_reach || '',
    editorialNarrativeFocus: entry?.editorial_narrative_focus || '',
    countryOfPublication: entry?.country_of_publication || '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const url = isEdit ? `/api/meeting-prep/media-library/${entry!.id}` : '/api/meeting-prep/media-library'
    const method = isEdit ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to save publication.')
    } else if (isEdit) {
      setSuccess(true)
      router.refresh()
    } else {
      router.push('/admin/meeting-prep/media-library')
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
          Publication saved successfully.
        </div>
      )}

      <div className="bg-white border border-[#e5e3df]">
        <div className="p-5 sm:p-6 flex flex-col gap-5">
          <Input
            label="Publication Name *"
            placeholder="e.g. Global FDI Report"
            value={form.publicationName}
            onChange={(e) => setForm(p => ({ ...p, publicationName: e.target.value }))}
            required
          />
          <Input
            label="Country of Publication *"
            placeholder="e.g. United Kingdom"
            value={form.countryOfPublication}
            onChange={(e) => setForm(p => ({ ...p, countryOfPublication: e.target.value }))}
            required
          />
          <Textarea
            label="Positioning Statement"
            placeholder="How this publication positions itself editorially and commercially."
            value={form.positioningStatement}
            onChange={(e) => setForm(p => ({ ...p, positioningStatement: e.target.value }))}
            rows={3}
          />
          <Textarea
            label="Audience & Reach"
            placeholder="Who reads this publication and how far it reaches."
            value={form.audienceReach}
            onChange={(e) => setForm(p => ({ ...p, audienceReach: e.target.value }))}
            rows={3}
          />
          <Textarea
            label="Editorial Narrative Focus"
            placeholder="The business/investment narrative this publication pursues — used to frame research and presentation points."
            value={form.editorialNarrativeFocus}
            onChange={(e) => setForm(p => ({ ...p, editorialNarrativeFocus: e.target.value }))}
            rows={4}
          />
        </div>
        <div className="px-5 sm:px-6 py-4 border-t border-[#e5e3df] bg-gray-50 flex items-center justify-end">
          <Button type="submit" loading={loading} arrow size="sm">
            {isEdit ? 'Save Changes' : 'Add Publication'}
          </Button>
        </div>
      </div>
    </form>
  )
}
