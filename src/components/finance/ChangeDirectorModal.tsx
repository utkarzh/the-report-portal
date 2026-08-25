'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'

interface FinanceUser {
  id: string
  full_name: string | null
  email: string
}

interface Props {
  open: boolean
  onClose: () => void
  onChanged: () => void
  projectId: string
  currentDirectorUserId?: string
}

export default function ChangeDirectorModal({ open, onClose, onChanged, projectId, currentDirectorUserId }: Props) {
  const [users, setUsers] = useState<FinanceUser[]>([])
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { setUserId(''); setError(null); return }
    fetch('/api/finance/users').then(r => r.json()).then(d => setUsers(d.users ?? [])).catch(() => setUsers([]))
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) { setError('Select the new director.'); return }
    setError(null)
    setLoading(true)

    const res = await fetch(`/api/finance/projects/${projectId}/director`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newDirectorUserId: userId }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to change the director.')
      setLoading(false)
      return
    }

    setLoading(false)
    onChanged()
    onClose()
  }

  const options = users.filter(u => u.id !== currentDirectorUserId)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-sm shadow-2xl flex flex-col rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df]">
          <h2 className="text-sm font-semibold text-gray-900">Change director</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 flex flex-col gap-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded">{error}</div>}
          <Select
            label="New director *"
            options={options.map(u => ({ value: u.id, label: `${u.full_name || u.email} · ${u.email}` }))}
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="Select from your team…"
          />
          <p className="text-xs text-gray-500">
            The current director is removed and this person becomes financially accountable for the project instead.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={loading} arrow>Change director</Button>
            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
