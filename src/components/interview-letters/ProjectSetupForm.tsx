'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import { formatDayMonthYear } from '@/lib/date-format'
import MediaSelect from '@/components/ui/MediaSelect'
import { INTERVIEW_LETTER_COMPANIES, INTERVIEW_LETTER_VARIANTS, matchBriefs } from '@/lib/interview-letters'
import { findMedia } from '@/lib/media-library'
import type { InterviewLetterBriefOption, InterviewLetterVariant, MediaOption } from '@/types'

interface Props {
  isAtLimit: boolean
  // The central Media Library, with each publication's letter description.
  media: (MediaOption & { letter_description: string })[]
  briefs: InterviewLetterBriefOption[]
  sectorSuggestions: string[]
}

// 'auto' follows the best match for the typed country; 'none' opts out.
type BriefChoice = 'auto' | 'none' | string


export default function ProjectSetupForm({ isAtLimit, media, briefs, sectorSuggestions }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [briefChoice, setBriefChoice] = useState<BriefChoice>('auto')
  const [form, setForm] = useState({
    company: '',
    letterVariant: '' as InterviewLetterVariant | '',
    anchor: '',
    projectCountry: '',
    reportSector: '',
    mediaPartner: '',
    mediaPartnerCountry: '',
    publicationTiming: '',
    hookInput: '',
    senderName: '',
    senderTitle: '',
    senderContact: '',
  })

  function handleChange(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const matches = useMemo(() => matchBriefs(briefs, form.projectCountry), [briefs, form.projectCountry])
  const selectedBrief =
    briefChoice === 'none' ? null
    : briefChoice === 'auto' ? matches[0] || null
    : briefs.find((b) => b.id === briefChoice) || null
  const otherBriefs = briefs.filter((b) => !matches.includes(b))

  const mediaMatch = findMedia(media, form.mediaPartner) || null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isAtLimit) return
    if (!form.letterVariant) {
      setError('Choose whether the report has an anchor.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/interview-letters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, editorialBriefId: selectedBrief?.id ?? null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to start the project. Please try again.')
        setLoading(false)
        return
      }
      const { id } = await res.json()
      router.push(`/interview-letters/${id}?generating=true`)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  const briefLabel = (b: InterviewLetterBriefOption) =>
    `${b.title}${b.media_partner ? ` · ${b.media_partner}` : ''} · ${formatDayMonthYear(b.created_at)}`

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      )}

      <Select
        label="Company *"
        options={INTERVIEW_LETTER_COMPANIES.map((c) => ({ value: c.value, label: c.label }))}
        value={form.company}
        onChange={(e) => handleChange('company', e.target.value)}
        placeholder="Select a company"
        required
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Letter version *</legend>
        {INTERVIEW_LETTER_VARIANTS.map((v) => {
          const active = form.letterVariant === v.value
          return (
            <label
              key={v.value}
              className={`flex cursor-pointer items-start gap-2.5 border px-3 py-2.5 transition-colors ${
                active ? 'border-black bg-[#faf9f7]' : 'border-[#e5e3df] hover:border-gray-400'
              }`}
            >
              <input
                type="radio"
                name="letterVariant"
                value={v.value}
                checked={active}
                onChange={() => handleChange('letterVariant', v.value)}
                className="mt-0.5 accent-black"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">{v.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{v.description}</span>
              </span>
            </label>
          )
        })}
      </fieldset>

      {form.letterVariant === 'anchor' && (
        <Textarea
          label="Anchor *"
          placeholder="e.g. Munich Security Conference, 12–14 February 2027. The report is distributed to delegates."
          value={form.anchor}
          onChange={(e) => handleChange('anchor', e.target.value)}
          rows={3}
          required
        />
      )}

      <Input
        label="Project Country *"
        placeholder="e.g. Libya"
        value={form.projectCountry}
        onChange={(e) => handleChange('projectCountry', e.target.value)}
        required
      />

      {form.projectCountry.trim() && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="editorial-brief" className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Editorial Brief
          </label>
          <select
            id="editorial-brief"
            value={briefChoice === 'auto' ? (matches[0]?.id || 'none') : briefChoice}
            onChange={(e) => setBriefChoice(e.target.value)}
            className="w-full appearance-none border-b border-gray-300 bg-transparent py-2 text-sm focus:border-black focus:outline-none"
          >
            {matches.length > 0 && (
              <optgroup label={`Matching ${form.projectCountry.trim()}`}>
                {matches.map((b) => <option key={b.id} value={b.id}>{briefLabel(b)}</option>)}
              </optgroup>
            )}
            <option value="none">Don’t use an Editorial Brief</option>
            {otherBriefs.length > 0 && (
              <optgroup label="Other Editorial Briefs">
                {otherBriefs.map((b) => <option key={b.id} value={b.id}>{briefLabel(b)}</option>)}
              </optgroup>
            )}
          </select>
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-gray-400">
            <FileText size={12} className="mt-0.5 flex-shrink-0" />
            {selectedBrief
              ? 'The research uses this brief as its main reference, then checks it against the latest sources and adds anything new.'
              : matches.length === 0
                ? `No Editorial Brief found for ${form.projectCountry.trim()}. The research will start from scratch with web search.`
                : 'The research will start from scratch with web search.'}
          </p>
        </div>
      )}

      <div>
        <Input
          label="Report Sector / Theme"
          placeholder="e.g. Business & Investment, Tourism, Security"
          value={form.reportSector}
          onChange={(e) => handleChange('reportSector', e.target.value)}
          list="report-sector-suggestions"
        />
        <datalist id="report-sector-suggestions">
          {sectorSuggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
        <p className="mt-1.5 text-xs text-gray-400">Helps the AI choose the right sample letters and focus the research.</p>
      </div>

      <div>
        <MediaSelect
          label="Media Partner *"
          options={media}
          value={form.mediaPartner}
          onChange={(name, option) =>
            setForm((prev) => ({ ...prev, mediaPartner: name, mediaPartnerCountry: option?.country || prev.mediaPartnerCountry }))
          }
          required
        />
        {mediaMatch && (
          mediaMatch.letter_description.trim() ? (
            <div className="mt-1.5 text-xs leading-relaxed text-gray-500">
              <p className="flex items-start gap-1.5 text-emerald-700">
                <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" />
                Its letter description will be copied into the letter word for word:
              </p>
              <p className="mt-1 border-l-2 border-[#e5e3df] pl-2.5 text-gray-500">{mediaMatch.letter_description}</p>
            </div>
          ) : (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-amber-700">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              This publication has no letter description yet, so the letter will leave that part out (the AI never
              writes one). An admin can add it under Admin → Media Library.
            </p>
          )
        )}
      </div>

      <Input
        label="Media Partner Country"
        placeholder="e.g. Germany"
        value={form.mediaPartnerCountry}
        onChange={(e) => handleChange('mediaPartnerCountry', e.target.value)}
      />

      <div>
        <Input
          label="Publication Timing"
          placeholder="e.g. February 2027"
          value={form.publicationTiming}
          onChange={(e) => handleChange('publicationTiming', e.target.value)}
        />
        <p className="mt-1.5 text-xs text-gray-400">Only if confirmed. Leave blank and the letter won&apos;t name a date.</p>
      </div>

      <div>
        <Textarea
          label="Additional Context"
          placeholder="e.g. Angle to emphasise, confirmed details, things to avoid…"
          value={form.hookInput}
          onChange={(e) => handleChange('hookInput', e.target.value)}
          rows={3}
        />
        <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
          Anything the AI should know that isn&apos;t in the Editorial Brief. Optional: the research proposes the why-now
          hook either way.
        </p>
      </div>

      <div className="border-t border-[#e5e3df] pt-5">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Sender
        </h3>
        <p className="mb-4 text-xs leading-relaxed text-gray-400">
          Who signs the letter and the cover email. Used for the letter&apos;s signature in downloads.
        </p>
        <div className="flex flex-col gap-5">
          <Input
            label="Sender Name *"
            placeholder="e.g. Adrienne Mendoza"
            value={form.senderName}
            onChange={(e) => handleChange('senderName', e.target.value)}
            required
          />
          <Input
            label="Sender Title *"
            placeholder="e.g. International Relations"
            value={form.senderTitle}
            onChange={(e) => handleChange('senderTitle', e.target.value)}
            required
          />
          <Input
            label="Sender Contact"
            placeholder="e.g. Email, phone, or WhatsApp"
            value={form.senderContact}
            onChange={(e) => handleChange('senderContact', e.target.value)}
          />
        </div>
      </div>

      <div className="pt-1">
        <Button type="submit" loading={loading} arrow disabled={isAtLimit}>
          Start Project
        </Button>
      </div>
    </form>
  )
}
