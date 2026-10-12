'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FolderPlus, Plus, X } from 'lucide-react'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import SearchableSelect from '@/components/ui/SearchableSelect'

export interface UserOption {
  value: string
  label: string
}

// US-098: admin creates a department and (optionally) sets its Guardian.
// `redirectBase` is where the new department opens (`${redirectBase}/${id}`).
export default function DepartmentFormModal({
  users,
  defaultGuardianId = '',
  redirectBase = '/knowledge/admin',
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
        className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-900"
      >
        <Plus size={15} /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="modal-backdrop-in absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <form onSubmit={submit} className="modal-panel-in relative w-full max-w-md overflow-hidden rounded-2xl bg-white text-left shadow-xl">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-4 top-4 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
              <X size={16} />
            </button>
            <div className="flex items-start gap-3 border-b border-[#eceae5] px-6 pb-4 pt-6 pr-12">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#fbf7ed] text-[#a07530]">
                <FolderPlus size={17} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">New department</h3>
                <p className="mt-0.5 text-xs leading-5 text-gray-500">A department holds the knowledge for one team. You’ll add its members on the next screen.</p>
              </div>
            </div>
            <div className="flex flex-col gap-5 px-6 py-5">
              <Input label="Name *" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Editorial, Business Development, Graphics" required autoFocus />
              <Textarea label="Short description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this department’s knowledge covers" />
              <div>
                <SearchableSelect label="Guardian" options={users} value={guardianId} onChange={setGuardianId} placeholder="Choose a Guardian (can be set later)" searchPlaceholder="Search users…" />
                <p className="mt-1.5 text-[11px] leading-4 text-gray-400">The only person who can publish this department’s knowledge. They get Knowledge Base access automatically.</p>
              </div>
              {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            </div>
            <div className="flex gap-3 border-t border-[#eceae5] bg-[#fcfbf9] px-6 py-4">
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} className="flex-1 justify-center">
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={busy} className="flex-1 justify-center">
                Create department
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
