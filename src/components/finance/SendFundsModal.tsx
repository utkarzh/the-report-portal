'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

interface Props {
  open: boolean
  onClose: () => void
  onSent: () => void
  projectId: string
  settlementCurrency: string
}

export default function SendFundsModal({ open, onClose, onSent, projectId, settlementCurrency }: Props) {
  const [amount, setAmount] = useState('')
  const [dateSent, setDateSent] = useState(() => new Date().toISOString().slice(0, 10))
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!file) { setError('Photographic evidence is required.'); return }
    setLoading(true)

    try {
      const supabase = getSupabaseBrowserClient()
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${projectId}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('finance-receipts').upload(path, file)
      if (uploadError) throw new Error(uploadError.message)

      const res = await fetch(`/api/finance/projects/${projectId}/funding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, dateSent, proofImagePath: path }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to record the transfer.')
      }

      setAmount(''); setFile(null)
      onSent()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md shadow-2xl flex flex-col rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df]">
          <h2 className="text-sm font-semibold text-gray-900">Send funds to director</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 flex flex-col gap-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label={`Amount (${settlementCurrency}) *`}
              type="number"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
            />
            <Input
              label="Date sent *"
              type="date"
              value={dateSent}
              onChange={e => setDateSent(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">
              Photographic evidence *
            </label>
            <input
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="text-sm w-full border border-[#e5e3df] rounded-lg px-3 py-2.5"
              required
            />
          </div>

          <p className="text-xs text-gray-500">
            This adds to the project&apos;s received funds and appears in the balance ledger. Only Finance can record funding.
          </p>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={loading} arrow>Record transfer</Button>
            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
