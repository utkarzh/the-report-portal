'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import MediaSelect from '@/components/ui/MediaSelect'
import { MODULE_PATH, API_PATH, PRESENTATION_LANGUAGES, defaultProjectName } from '@/lib/commercial-presentations'
import type { Agency, MediaOption } from '@/types'
import { Card, CardHeader, FieldLabel, Notice, PrimaryButton, inputClass } from './ui'

// Step 1 of the brief's flow (§3, §25): select Agency + Media + Project. The
// project is identified by agency + country + media + edition; the country
// comes from the project, so it's never asked again later.

export default function PresentationCreateForm({
  agencies,
  media,
  missingScripts,
}: {
  agencies: Pick<Agency, 'id' | 'name'>[]
  media: MediaOption[]
  /** media id → note, for publications without an approved script yet. */
  missingScripts: Record<string, string>
}) {
  const router = useRouter()
  const [agencyId, setAgencyId] = useState(agencies[0]?.id || '')
  const [mediaName, setMediaName] = useState('')
  const [mediaId, setMediaId] = useState('')
  const [country, setCountry] = useState('')
  const [edition, setEdition] = useState(String(new Date().getFullYear()))
  const [name, setName] = useState('')
  const [anchorEvent, setAnchorEvent] = useState('')
  const [anchorDate, setAnchorDate] = useState('')
  const [language, setLanguage] = useState('en')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingId, setExistingId] = useState<string | null>(null)

  const suggestedName = defaultProjectName({ country, mediaName, edition })
  const scriptNote = mediaId ? missingScripts[mediaId] : undefined

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setExistingId(null)
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agencyId, mediaId, country, edition, name: name.trim() || suggestedName, anchorEvent, anchorDate, language }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.status === 409 && data.existingId) {
      setExistingId(data.existingId)
      return
    }
    if (!res.ok) {
      setError(data.error || 'Could not create the presentation.')
      return
    }
    router.push(`${MODULE_PATH}/${data.id}`)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Project" description="A project is one report: agency + country + media + edition. The presentation is created once per project and reused in every meeting." />
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <FieldLabel htmlFor="agency">Agency *</FieldLabel>
            <select id="agency" className={inputClass} value={agencyId} onChange={(e) => setAgencyId(e.target.value)} required>
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <MediaSelect
              label="Media *"
              options={media}
              value={mediaName}
              required
              onChange={(n, option) => {
                setMediaName(n)
                setMediaId(option?.id || '')
              }}
            />
            {scriptNote && <p className="mt-1.5 text-xs text-amber-700">{scriptNote}</p>}
          </div>
          <div>
            <FieldLabel htmlFor="country">Country *</FieldLabel>
            <input id="country" className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Kazakhstan" required />
          </div>
          <div>
            <FieldLabel htmlFor="edition">Edition</FieldLabel>
            <input id="edition" className={inputClass} value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="e.g. 2026 or November 2026" />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="project-name">Project name</FieldLabel>
            <input id="project-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName || 'Kazakhstan × USA Today 2026'} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Anchor event (optional)" description="Leave blank if there isn't one: the presentation then uses the “without anchor event” wording and the AI finds the strongest Why Now itself." />
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <FieldLabel htmlFor="anchor">Anchor event / editorial momentum</FieldLabel>
            <input id="anchor" className={inputClass} value={anchorEvent} onChange={(e) => setAnchorEvent(e.target.value)} placeholder="e.g. G20 Summit in Miami" />
          </div>
          <div>
            <FieldLabel htmlFor="anchor-date">Relevant date</FieldLabel>
            <input id="anchor-date" className={inputClass} value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} placeholder="e.g. November 2026" />
          </div>
          <div>
            <FieldLabel htmlFor="language">Presentation language</FieldLabel>
            <select id="language" className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {PRESENTATION_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value} disabled={!l.available}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {existingId && (
        <Notice tone="info" action={<Link href={`${MODULE_PATH}/${existingId}`} className="text-sm font-medium underline">Open it</Link>}>
          This project already has a commercial presentation.
        </Notice>
      )}

      <div>
        <PrimaryButton type="submit" loading={saving} disabled={!agencyId || !mediaId || !country.trim()}>
          Create presentation
        </PrimaryButton>
      </div>
    </form>
  )
}
