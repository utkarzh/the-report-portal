'use client'

import { useState, useEffect } from 'react'
import { X, UserPlus } from 'lucide-react'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
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
      <div className="relative bg-white w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black flex items-center justify-center flex-shrink-0">
              <UserPlus size={15} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Personalize for a Recipient</h2>
              <p className="text-xs text-gray-500 mt-0.5">All fields are optional</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors flex-shrink-0" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-6">
            <InterviewLetterLoader label="Personalizing for this recipient…" elapsedSecs={elapsedSecs} variant="personalize" />
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="px-6 py-6 flex flex-col gap-4 overflow-y-auto">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

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
            <Button type="submit" loading={loading} arrow>
              Generate Personalized Outputs
            </Button>
            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
              Cancel
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  )
}
