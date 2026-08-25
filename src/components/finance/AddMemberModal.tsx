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
  onAdded: () => void
  projectId: string
  existingMemberUserIds: string[]
}

export default function AddMemberModal({ open, onClose, onAdded, projectId, existingMemberUserIds }: Props) {
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
    if (!userId) { setError('Select an account.'); return }
    setError(null)
    setLoading(true)

    // Only Sales Reps are added here — a project always has exactly one
    // Director, changed only via the dedicated "Change director" action.
    const res = await fetch(`/api/finance/projects/${projectId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, projectRole: 'sales_rep' }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to add member.')
      setLoading(false)
      return
    }

    setLoading(false)
    onAdded()
    onClose()
  }

  const availableUsers = users.filter(u => !existingMemberUserIds.includes(u.id))
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-sm shadow-2xl flex flex-col rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df]">
          <h2 className="text-sm font-semibold text-gray-900">Add sales rep</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 flex flex-col gap-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded">{error}</div>}

          <Select
            label="Account *"
            options={availableUsers.map(u => ({ value: u.id, label: `${u.full_name || u.email} · ${u.email}` }))}
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder={availableUsers.length ? 'Select from your team…' : 'Everyone is already on this project'}
          />
          <p className="text-xs text-gray-500">
            Only accounts with Finance access already enabled (Admin → Users → Edit), not already on this
            project, appear here. To change the Director instead, use &quot;Change director&quot; next to
            their name.
          </p>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={loading} arrow>Add sales rep</Button>
            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
