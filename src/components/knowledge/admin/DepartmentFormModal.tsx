'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'

export interface UserOption {
  value: string
  label: string
}

// US-098: admin creates a department and (optionally) sets its Guardian.
// Used on Admin → Knowledge Base and on the Knowledge Base's own Manage page,
// so an admin can create one from wherever they are. `redirectBase` is where
// the new department opens (`${redirectBase}/${id}`).
export default function DepartmentFormModal({
  users,
  defaultGuardianId = '',
  redirectBase = '/admin/knowledge',
  label = 'New department',
}: {
  users: UserOption[]
  defaultGuardianId?: string
  redirectBase?: string
  label?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [guardianId, setGuardianId] = useState(defaultGuardianId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/knowledge/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, guardianId: guardianId || null }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(data.error || 'Could not create the department.')
      return
    }
    setOpen(false)
    setName('')
    setDescription('')
    setGuardianId(defaultGuardianId)
    router.push(`${redirectBase}/${data.department.id}`)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-black px-5 py-3 text-xs font-medium uppercase tracking-wider text-white hover:bg-gray-900"
      >
        <Plus size={14} /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="modal-backdrop-in absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <form onSubmit={submit} className="modal-panel-in relative flex w-full max-w-md flex-col gap-5 rounded-xl bg-white p-6 shadow-xl">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-700" aria-label="Close"><X size={16} /></button>
            <h3 className="text-sm font-semibold text-gray-900">New department</h3>
            <Input label="Name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Editorial, Business Development, Graphics" required />
            <Textarea label="Short description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            <div>
              <SearchableSelect label="Guardian" options={users} value={guardianId} onChange={setGuardianId} placeholder="Choose a Guardian (can be set later)" searchPlaceholder="Search users…" />
              <p className="mt-1.5 text-[11px] text-gray-400">The only person who can publish this department’s knowledge. They get Knowledge Base access automatically.</p>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button type="submit" size="sm" loading={busy} className="justify-center">Create department</Button>
          </form>
        </div>
      )}
    </>
  )
}
