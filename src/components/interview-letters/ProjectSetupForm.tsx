'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import { INTERVIEW_LETTER_COMPANIES } from '@/lib/interview-letters'

interface Props {
  isAtLimit: boolean
}

export default function ProjectSetupForm({ isAtLimit }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    company: '',
    projectCountry: '',
    mediaPartner: '',
    mediaPartnerCountry: '',
    hookInput: '',
    senderName: '',
    senderTitle: '',
    senderContact: '',
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
      const res = await fetch('/api/interview-letters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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

      <Input
        label="Project Country *"
        placeholder="e.g. Brazil"
        value={form.projectCountry}
        onChange={(e) => handleChange('projectCountry', e.target.value)}
        required
      />

      <Input
        label="Media Partner *"
        placeholder="e.g. Financial Times"
        value={form.mediaPartner}
        onChange={(e) => handleChange('mediaPartner', e.target.value)}
        required
      />

      <Input
        label="Media Partner Country"
        placeholder="e.g. United Kingdom"
        value={form.mediaPartnerCountry}
        onChange={(e) => handleChange('mediaPartnerCountry', e.target.value)}
      />

      <div>
        <Textarea
          label="Why-Now / Event Hook & Important Context"
          placeholder="e.g. Timed to the company's Q3 earnings announcement..."
          value={form.hookInput}
          onChange={(e) => handleChange('hookInput', e.target.value)}
          rows={4}
        />
        <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
          This is important because AI may not know the exact planned publication window. Provide the hook
          when it&apos;s already known — or leave it blank so AI can research and propose one.
        </p>
      </div>

      <div className="border-t border-[#e5e3df] pt-5">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Cover Email Sender
        </h3>
        <p className="mb-4 text-xs leading-relaxed text-gray-400">
          Who the cover email will be signed by — the letter itself has its own fixed signature and doesn&apos;t use
          these details.
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
