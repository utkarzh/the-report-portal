'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import { FLOW_STEPS, MAX_IMAGE_COUNT } from '@/lib/copywriting'

interface Props {
  publications: { id: string; name: string }[]
  articleTypes: { id: string; name: string }[]
}

export default function NewProjectForm({ publications, articleTypes }: Props) {
  const router = useRouter()
  const [draftName, setDraftName] = useState('')
  const [publicationId, setPublicationId] = useState('')
  const [articleTypeId, setArticleTypeId] = useState('')
  const [editorialObjective, setEditorialObjective] = useState('')
  const [sectionStructure, setSectionStructure] = useState('')
  const [targetLength, setTargetLength] = useState('')
  const [quotesRequired, setQuotesRequired] = useState('')
  const [imageCount, setImageCount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!draftName.trim()) return setError('Draft name is required')
    if (!publicationId) return setError('Select a publication')
    if (!articleTypeId) return setError('Select an article type')
    if (imageCount !== '') {
      const n = Number(imageCount)
      if (!Number.isInteger(n) || n < 0 || n > MAX_IMAGE_COUNT) return setError(`Number of images must be a whole number from 0 to ${MAX_IMAGE_COUNT}`)
    }

    setLoading(true)
    const res = await fetch('/api/copywriting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftName,
        publicationId,
        articleTypeId,
        editorialObjective,
        sectionStructure,
        targetLength: targetLength ? Number(targetLength) : null,
        quotesRequired: quotesRequired ? Number(quotesRequired) : null,
        imageCount: imageCount !== '' ? Number(imageCount) : null,
      }),
    })
    setLoading(false)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setError(data.error || 'Failed to create project')
    router.push(`/copywriting/${data.id}`)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
      <form onSubmit={handleSubmit} className="lg:col-span-3 flex flex-col gap-5 bg-white border border-[#e5e3df] p-6 sm:p-8">
        <Input label="Draft name" placeholder="e.g. Interview with the Minister of Trade" value={draftName} onChange={(e) => setDraftName(e.target.value)} required />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Select
            label="Publication"
            value={publicationId}
            onChange={(e) => setPublicationId(e.target.value)}
            options={publications.map((p) => ({ value: p.id, label: p.name }))}
            required
          />
          <Select
            label="Article type"
            value={articleTypeId}
            onChange={(e) => setArticleTypeId(e.target.value)}
            options={articleTypes.map((t) => ({ value: t.id, label: t.name }))}
            required
          />
        </div>
        <Textarea label="Editorial objective" placeholder="What is this article meant to achieve?" rows={3} value={editorialObjective} onChange={(e) => setEditorialObjective(e.target.value)} />
        <Textarea label="Section structure" hint="optional" placeholder="e.g. Intro, three thematic sections, closing quote" rows={3} value={sectionStructure} onChange={(e) => setSectionStructure(e.target.value)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Input label="Target length (words)" type="number" min={0} value={targetLength} onChange={(e) => setTargetLength(e.target.value)} />
          <Input label="Quotes required" type="number" min={0} value={quotesRequired} onChange={(e) => setQuotesRequired(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <Input
              label="Number of images"
              hint="optional"
              type="number"
              min={0}
              max={MAX_IMAGE_COUNT}
              step={1}
              placeholder="AI decides"
              value={imageCount}
              onChange={(e) => setImageCount(e.target.value)}
            />
            <p className="text-[11px] text-gray-400 mt-1.5">
              Leave blank to let the AI decide from the article type and guides; 0 for no images. Each image becomes a slot in the draft to upload a photo into.
            </p>
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <Button type="submit" loading={loading} arrow>Configure</Button>
      </form>

      <div className="lg:col-span-2 flex flex-col justify-center">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-6">What happens next</p>
        <div className="relative flex flex-col gap-0">
          {FLOW_STEPS.map((step, i) => (
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              className="relative flex items-start gap-4 pb-8 last:pb-0"
            >
              {i < FLOW_STEPS.length - 1 && (
                <span className="absolute left-[15px] top-8 bottom-0 w-px bg-[#e5e3df]" />
              )}
              <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-black text-white text-xs font-semibold">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-900">{step}</p>
                <p className="text-xs text-gray-400 mt-0.5">{FLOW_DESCRIPTIONS[step]}</p>
              </div>
            </motion.div>
          ))}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: FLOW_STEPS.length * 0.12 + 0.1 }}
            className="flex items-center gap-2 mt-2 text-xs text-gray-400"
          >
            <Check size={13} className="text-emerald-500" />
            Final article — Copy, Word, or PDF
          </motion.div>
        </div>
      </div>
    </div>
  )
}

const FLOW_DESCRIPTIONS: Record<(typeof FLOW_STEPS)[number], string> = {
  Upload: 'Add interview transcripts, releases, and supporting material.',
  Analyze: 'Claude extracts style, rules, quotable lines, facts, and gaps.',
  Research: 'Gemini checks flagged gaps against outside sources.',
  Plan: 'Claude proposes the thesis, structure, and paragraph plan.',
  Draft: 'A full first draft, automatically checked for common issues.',
  Review: 'Refine by chat, then export the approved final version.',
}
