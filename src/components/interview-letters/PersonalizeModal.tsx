'use client'

import { useState, useEffect } from 'react'
import { X, UserPlus, Sparkles, Loader2 } from 'lucide-react'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import InterviewLetterLoader from '@/components/interview-letters/InterviewLetterLoader'
import type { InterviewLetterPersonalization } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (p: InterviewLetterPersonalization) => void
  projectId: string
}

const defaultForm = {
  recipientName: '',
  recipientTitle: '',
  recipientOrganisation: '',
  recipientSector: '',
  recipientContext: '',
}

export default function PersonalizeModal({ open, onClose, onCreated, projectId }: Props) {
  const [form, setForm] = useState(defaultForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setForm(defaultForm)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const [elapsedSecs, setElapsedSecs] = useState(0)
  useEffect(() => {
    if (!loading) return
    const startedAt = Date.now()
    setElapsedSecs(0)
    const ticker = setInterval(() => setElapsedSecs(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(ticker)
  }, [loading])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await fetch(`/api/interview-letters/${projectId}/personalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) {
      setError(data.error || 'Failed to personalize.')
      return
    }
    onCreated(data.personalization)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[#e5e3df] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-black">
              <UserPlus size={16} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Personalize for a Recipient</h2>
              <p className="mt-0.5 text-xs text-gray-500">All fields are optional</p>
            </div>
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-6">
            <InterviewLetterLoader label="Personalizing for this recipient…" elapsedSecs={elapsedSecs} variant="personalize" />
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto px-6 py-6">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          <Input
            label="Recipient Name"
            value={form.recipientName}
            onChange={(e) => setForm((p) => ({ ...p, recipientName: e.target.value }))}
            placeholder="e.g. Jane Doe"
          />
          <Input
            label="Title / Position"
            value={form.recipientTitle}
            onChange={(e) => setForm((p) => ({ ...p, recipientTitle: e.target.value }))}
            placeholder="e.g. CEO, Minister, President"
          />
          <Input
            label="Organisation"
            value={form.recipientOrganisation}
            onChange={(e) => setForm((p) => ({ ...p, recipientOrganisation: e.target.value }))}
          />
          <Input
            label="Sector / Portfolio"
            value={form.recipientSector}
            onChange={(e) => setForm((p) => ({ ...p, recipientSector: e.target.value }))}
          />
          <Textarea
            label="Additional Context"
            value={form.recipientContext}
            onChange={(e) => setForm((p) => ({ ...p, recipientContext: e.target.value }))}
            placeholder="Anything else useful for a senior or unusual case"
            rows={3}
          />

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Generate Personalized Outputs
            </button>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800">
              Cancel
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  )
}
