'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ArrowDown, Trash2, Plus, Upload } from 'lucide-react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import PromptVersionHistory from '@/components/admin/PromptVersionHistory'
import type { InterviewLetterCompany, InterviewLetterParagraphSlot } from '@/types'

interface Props {
  company: InterviewLetterCompany
  label: string
  initialStructure: InterviewLetterParagraphSlot[]
}

const GENERATE_ACCEPT = '.docx,.pdf,.txt,.md'

function emptySlot(): InterviewLetterParagraphSlot {
  return { key: '', type: 'variable', label: '', instructions: '', wordBudget: 60 }
}

export default function InterviewLetterTemplateForm({ company, label, initialStructure }: Props) {
  const router = useRouter()
  const [structure, setStructure] = useState<InterviewLetterParagraphSlot[]>(initialStructure)
  const [savedStructure, setSavedStructure] = useState<InterviewLetterParagraphSlot[]>(initialStructure)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [versionRefreshKey, setVersionRefreshKey] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  function updateSlot(index: number, patch: Partial<InterviewLetterParagraphSlot>) {
    setStructure((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function moveSlot(index: number, dir: -1 | 1) {
    setStructure((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function removeSlot(index: number) {
    setStructure((prev) => prev.filter((_, i) => i !== index))
  }

  function addSlot() {
    setStructure((prev) => [...prev, emptySlot()])
  }

  async function handleGenerateFromDocument(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file again later
    if (!file) return
    if (
      structure.length > 0 &&
      !window.confirm('This will replace the paragraphs below with a new structure generated from the document. Continue?')
    ) {
      return
    }

    setGenerating(true)
    setGenerateError(null)
    setSuccess(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/interview-letters/templates/${company}/generate-from-document`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        setGenerateError(data.error || 'Failed to generate a structure from that document.')
        return
      }
      setStructure(data.structure)
    } catch {
      setGenerateError('Network error while generating from the document.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const keys = structure.map((s) => s.key.trim())
    if (keys.some((k) => !k)) {
      setError('Every paragraph needs a key.')
      return
    }
    if (new Set(keys).size !== keys.length) {
      setError('Paragraph keys must be unique.')
      return
    }

    setLoading(true)
    const res = await fetch(`/api/interview-letters/templates/${company}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structure }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to save template.')
    } else {
      setSavedStructure(structure)
      setSuccess(true)
      setVersionRefreshKey((k) => k + 1)
      router.refresh()
    }
    setLoading(false)
  }

  const dirty = JSON.stringify(structure) !== JSON.stringify(savedStructure)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && <div className="p-4 bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {success && !dirty && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          Template saved. New {label} letters will use this structure.
        </div>
      )}

      <div className="bg-white border border-[#e5e3df] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-gray-900">Generate from a document</h3>
        <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">
          Upload an existing letter or template outline ({GENERATE_ACCEPT}) and Claude will draft the paragraphs
          below — fixed vs. variable, labels, instructions, word budgets — for you to review and edit before saving.
        </p>
        {generateError && <p className="text-xs text-red-600 mt-2">{generateError}</p>}
        <label
          className={`inline-flex items-center gap-2 text-xs font-medium tracking-wider uppercase border border-[#e5e3df] px-4 py-2.5 mt-3 cursor-pointer hover:border-gray-400 transition-colors ${
            generating ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          <Upload size={13} />
          {generating ? 'Generating…' : 'Upload Document'}
          <input
            type="file"
            accept={GENERATE_ACCEPT}
            className="hidden"
            disabled={generating}
            onChange={handleGenerateFromDocument}
          />
        </label>
      </div>

      <div className="flex flex-col gap-4">
        {structure.map((slot, i) => (
          <div key={i} className="bg-white border border-[#e5e3df] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                Paragraph {i + 1}
              </span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button type="button" onClick={() => moveSlot(i, -1)} disabled={i === 0} className="p-1.5 text-gray-400 hover:text-black disabled:opacity-30 disabled:hover:text-gray-400 transition-colors">
                  <ArrowUp size={14} />
                </button>
                <button type="button" onClick={() => moveSlot(i, 1)} disabled={i === structure.length - 1} className="p-1.5 text-gray-400 hover:text-black disabled:opacity-30 disabled:hover:text-gray-400 transition-colors">
                  <ArrowDown size={14} />
                </button>
                <button type="button" onClick={() => removeSlot(i)} className="p-1.5 text-gray-400 hover:text-red-600 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <Input
                label="Key"
                value={slot.key}
                onChange={(e) => updateSlot(i, { key: e.target.value.trim() })}
                placeholder="e.g. opening"
              />
              <Input
                label="Label"
                value={slot.label}
                onChange={(e) => updateSlot(i, { label: e.target.value })}
                placeholder="e.g. Opening / Why-Now Hook"
              />
              <Select
                label="Type"
                value={slot.type}
                onChange={(e) => updateSlot(i, { type: e.target.value as 'fixed' | 'variable' })}
                options={[
                  { value: 'variable', label: 'Variable (AI-generated)' },
                  { value: 'fixed', label: 'Fixed (immutable wording)' },
                ]}
                placeholder=""
              />
            </div>

            {slot.type === 'fixed' ? (
              <Textarea
                label="Fixed content"
                value={slot.content || ''}
                onChange={(e) => updateSlot(i, { content: e.target.value })}
                rows={3}
              />
            ) : (
              <div className="flex flex-col gap-4">
                <Textarea
                  label="Instructions for the model"
                  value={slot.instructions || ''}
                  onChange={(e) => updateSlot(i, { instructions: e.target.value })}
                  rows={3}
                />
                <Input
                  label="Word budget"
                  type="number"
                  value={String(slot.wordBudget || 60)}
                  onChange={(e) => updateSlot(i, { wordBudget: parseInt(e.target.value) || 0 })}
                  min="10"
                />
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={addSlot}
          className="flex items-center justify-center gap-2 border border-dashed border-[#e5e3df] py-3 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-black transition-colors"
        >
          <Plus size={14} /> Add paragraph
        </button>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={loading} arrow>
          Save Template
        </Button>
        {dirty && <span className="text-xs text-gray-400">Unsaved changes</span>}
      </div>

      <PromptVersionHistory
        type="interview_letter_template"
        company={company}
        currentPromptText={JSON.stringify(structure, null, 2)}
        refreshKey={versionRefreshKey}
        onRestore={(text) => {
          try {
            const parsed = JSON.parse(text) as InterviewLetterParagraphSlot[]
            setStructure(parsed)
            setSavedStructure(parsed)
          } catch {
            setError('Could not parse the restored version.')
            return
          }
          setSuccess(false)
          setError(null)
          setVersionRefreshKey((k) => k + 1)
          router.refresh()
        }}
      />
    </form>
  )
}
