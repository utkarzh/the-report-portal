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

  // Advertiser history is auto-matched from the per-country tracker, then
  // remains editable. Lookup runs when company + country are both filled.
  const [looking, setLooking] = useState(false)
  const [lookup, setLookup] = useState<
    { trackerFound: boolean; hasHistory?: boolean; matchCount?: number; filename?: string } | null
  >(null)
  const [lastKey, setLastKey] = useState('')

  async function runLookup() {
    const company = form.companyOrg.trim()
    const country = form.companyCountry.trim()
    if (!company || !country || looking) return
    const key = `${company}||${country}`.toLowerCase()
    if (key === lastKey) return
    setLastKey(key)
    setLooking(true)
    try {
      const res = await fetch(
        `/api/meeting-prep/advertiser-tracker/lookup?country=${encodeURIComponent(country)}&company=${encodeURIComponent(company)}`,
      )
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setLookup(null); return }
      setLookup(d)
      if (d.trackerFound) {
        setForm((prev) => ({
          ...prev,
          advertiserHistoryStatus: d.status || (d.hasHistory ? 'yes' : 'no'),
          advertiserHistoryDetails: d.details || '',
        }))
      }
    } catch {
      setLookup(null)
    } finally {
      setLooking(false)
    }
  }

  const publicationOptions = mediaLibrary.map(m => ({ value: m.publication_name, label: m.publication_name }))

  // A Government Official has no "company" — the entity is a ministry / body.
  // Wording adapts to the selected interviewee type.
  const isGov = form.intervieweeType === 'government_official'
  const orgLabel = isGov ? 'Government Body / Ministry *' : 'Company / Organisation *'
  const orgPlaceholder = isGov ? 'e.g. Ministry of Economy' : 'e.g. Acme Corp'
  const countryLabel = isGov ? 'Country *' : 'Country of the Company *'
  const countryPlaceholder = isGov ? 'e.g. Georgia' : 'e.g. Brazil'
  const orgWord = isGov ? 'organisation' : 'company'

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
        placeholder={isGov ? 'e.g. Minister of Economy' : 'e.g. Chief Executive Officer'}
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
        label={orgLabel}
        placeholder={orgPlaceholder}
        value={form.companyOrg}
        onChange={(e) => handleChange('companyOrg', e.target.value)}
        onBlur={runLookup}
        required
      />

      <Input
        label={countryLabel}
        placeholder={countryPlaceholder}
        value={form.companyCountry}
        onChange={(e) => handleChange('companyCountry', e.target.value)}
        onBlur={runLookup}
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

      <div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-800">Advertiser history (Commercial Alert)</label>
          {looking && <span className="text-xs text-gray-400">Checking tracker…</span>}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Optional — auto-filled from the {form.companyCountry.trim() || 'country'} advertiser tracker where available.
          Leave as &ldquo;Not aware&rdquo; if you don&rsquo;t know.
        </p>

        {lookup && !lookup.trackerFound && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No advertiser tracker on file for &ldquo;{form.companyCountry.trim()}&rdquo;. Ask an admin to upload it under
            Meeting Preparation → Advertiser Tracker, or enter the history manually below.
          </p>
        )}
        {lookup && lookup.trackerFound && lookup.hasHistory && (
          <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Matched {lookup.matchCount} row{lookup.matchCount === 1 ? '' : 's'} in {lookup.filename || 'the tracker'} —
            advertising history found and filled in below.
          </p>
        )}
        {lookup && lookup.trackerFound && !lookup.hasHistory && (
          <p className="mt-2 rounded-lg border border-[#e5e3df] bg-[#faf9f7] px-3 py-2 text-xs text-gray-600">
            No previous advertising found for &ldquo;{form.companyOrg.trim()}&rdquo; in the {form.companyCountry.trim()} tracker.
            Marked as &ldquo;No&rdquo; — override below if you know otherwise.
          </p>
        )}
      </div>

      <Select
        label={`Has this ${orgWord} previously advertised with TRC?`}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'not_aware', label: 'Not aware' },
        ]}
        value={form.advertiserHistoryStatus}
        onChange={(e) => handleChange('advertiserHistoryStatus', e.target.value)}
      />

      {form.advertiserHistoryStatus === 'yes' && (
        <Textarea
          label="Advertiser History Details *"
          placeholder="Publication, advertising space and approximate period."
          value={form.advertiserHistoryDetails}
          onChange={(e) => handleChange('advertiserHistoryDetails', e.target.value)}
          rows={4}
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
