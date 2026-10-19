'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import PublicationGuides, { type PublicationGuide } from '@/components/admin/PublicationGuides'
import { MEDIA_LIBRARY_PATH } from '@/lib/media-library'
import { MEDIA_DESCRIPTION_TOKEN, wordCount } from '@/lib/interview-letters'
import type { MediaLibraryEntry } from '@/types'

interface Props {
  entry: MediaLibraryEntry
  initialGuides: PublicationGuide[]
}

function Section({ title, used, children }: { title: string; used: string; children: React.ReactNode }) {
  return (
    <section className="border border-[#e5e3df] bg-white">
      <div className="border-b border-[#e5e3df] px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{used}</p>
      </div>
      <div className="flex flex-col gap-5 p-5 sm:p-6">{children}</div>
    </section>
  )
}

export default function MediaLibraryEntryForm({ entry, initialGuides }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    name: entry.name,
    country: entry.country || '',
    positioningStatement: entry.positioning_statement,
    audienceReach: entry.audience_reach,
    editorialNarrativeFocus: entry.editorial_narrative_focus,
    letterDescription: entry.letter_description,
    writingRules: entry.writing_rules,
  })
  const [saved, setSaved] = useState(form)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((p) => ({ ...p, [key]: e.target.value }))
    setSuccess(false)
  }
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/media-library/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setError(data.error || 'Failed to save.')
      return
    }
    setSaved(form)
    setSuccess(true)
    router.refresh()
  }

  async function remove() {
    setDeleting(true)
    const res = await fetch(`/api/media-library/${entry.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setDeleting(false)
      setConfirmDelete(false)
      setError(data.error || 'Failed to delete.')
      return
    }
    router.push(MEDIA_LIBRARY_PATH)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={save} className="flex flex-col gap-6">
        {error && <div className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {success && !dirty && <div className="border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">Saved.</div>}

        <Section title="Publication" used="Shown in the publication list of every tool. The country is filled in for the user when they pick it.">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Input label="Name *" value={form.name} onChange={set('name')} required />
            <Input label="Country" placeholder="e.g. Germany" value={form.country} onChange={set('country')} />
          </div>
        </Section>

        <Section
          title="Meeting Preparation"
          used="The publication's media profile, used to frame the research and presentation points. Meeting Preparation can only use a publication once at least one of these is filled in."
        >
          <Textarea label="Positioning statement" placeholder="How this publication positions itself editorially and commercially." value={form.positioningStatement} onChange={set('positioningStatement')} rows={3} />
          <Textarea label="Audience & reach" placeholder="Who reads this publication and how far it reaches." value={form.audienceReach} onChange={set('audienceReach')} rows={3} />
          <Textarea label="Editorial narrative focus" placeholder="The business/investment narrative this publication pursues." value={form.editorialNarrativeFocus} onChange={set('editorialNarrativeFocus')} rows={3} />
        </Section>

        <Section
          title="Interview Letters"
          used={`Copied into the letter exactly as written, wherever the letter template says ${MEDIA_DESCRIPTION_TOKEN}. State the audience and geographic reach accurately and write it to fit that sentence. Left empty, letters for this publication leave that part out.`}
        >
          <Textarea
            label="Letter description (word for word)"
            hint={form.letterDescription.trim() ? `${wordCount(form.letterDescription)} words` : undefined}
            placeholder="e.g. Germany's leading weekly news magazine, with [audience figure] readers across print and digital"
            value={form.letterDescription}
            onChange={set('letterDescription')}
            rows={3}
          />
        </Section>

        <Section
          title="Copywriting Tool"
          used="Rules for articles written for this publication, applied on top of TRC house rules (spelling, headline case, dashes, currency…), plus optional style guide files."
        >
          <Textarea label="Writing rules" placeholder="e.g. Use US English and title case for headlines…" value={form.writingRules} onChange={set('writingRules')} rows={4} />
        </Section>

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" loading={saving} disabled={!dirty}>Save changes</Button>
          {dirty && <span className="text-xs text-gray-400">Unsaved changes</span>}
        </div>
      </form>

      <section className="border border-[#e5e3df] bg-white p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-gray-900">Copywriting style guides</h2>
        <p className="mt-0.5 mb-4 text-xs text-gray-500">Saved as soon as they upload; used by every article for this publication.</p>
        <PublicationGuides publicationId={entry.id} initialGuides={initialGuides} />
      </section>

      <div className="border-t border-[#e5e3df] pt-6">
        <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs text-red-500 transition-colors hover:text-red-700">
          Delete this publication
        </button>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={`Delete "${entry.name}"?`}
        description="It disappears from every tool's publication list, along with its Meeting Prep profile, letter description, Copywriting rules and style guides. Work already created keeps the publication name it was saved with."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleting}
      />
    </div>
  )
}
