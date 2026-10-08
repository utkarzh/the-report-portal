'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Archive, ArchiveRestore, Trash2, UserPlus } from 'lucide-react'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import type { KnowledgeDepartment } from '@/types'
import type { UserOption } from '@/components/knowledge/admin/DepartmentFormModal'

export interface MemberRow {
  id: string
  name: string
  email: string
  status: string
  canAccess: boolean
}

// Admin controls for one department: name/description, Guardian (US-098,
// US-122), archive, and members (US-099).
export default function DepartmentSettings({
  department,
  users,
  members,
  guardianWarning,
}: {
  department: KnowledgeDepartment
  users: UserOption[]
  members: MemberRow[]
  guardianWarning: string | null
}) {
  const router = useRouter()
  const [name, setName] = useState(department.name)
  const [description, setDescription] = useState(department.description)
  const [guardianId, setGuardianId] = useState(department.guardian_id ?? '')
  const [addUser, setAddUser] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  async function call(label: string, url: string, method: string, body?: unknown) {
    setBusy(label)
    setError(null)
    setSaved(false)
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return false
    }
    router.refresh()
    return true
  }

  const memberIds = new Set(members.map((m) => m.id))
  const addable = users.filter((u) => !memberIds.has(u.value))
  const archived = !!department.archived_at

  return (
    <div className="flex flex-col gap-6">
      {guardianWarning && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {guardianWarning}
        </p>
      )}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <section className="rounded-xl border border-[#e5e3df] bg-white p-5">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Department</p>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await call('save', `/api/knowledge/departments/${department.id}`, 'PATCH', { name, description, guardianId: guardianId || null })) setSaved(true)
          }}
        >
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Textarea label="Short description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          <div>
            <SearchableSelect label="Guardian" options={[{ value: '', label: '— No Guardian (read-only) —' }, ...users]} value={guardianId} onChange={setGuardianId} searchPlaceholder="Search users…" />
            <p className="mt-1.5 text-[11px] text-gray-400">Changing the Guardian moves this department’s drafts and open suggestions to the new Guardian.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" loading={busy === 'save'}>Save</Button>
            {saved && <span className="text-xs text-emerald-700">Saved.</span>}
            <button
              type="button"
              onClick={() => (archived ? call('archive', `/api/knowledge/departments/${department.id}`, 'PATCH', { archived: false }) : setConfirmArchive(true))}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-black"
            >
              {archived ? <><ArchiveRestore size={13} /> Unarchive</> : <><Archive size={13} /> Archive department</>}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-[#e5e3df] bg-white p-5">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Members ({members.length})</p>
        <p className="mb-4 text-[11px] text-gray-500">Members see this department’s published knowledge, and the AI uses it for them. The Guardian always has access.</p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <SearchableSelect label="Add a user" options={addable} value={addUser} onChange={setAddUser} placeholder="Choose a user…" searchPlaceholder="Search users…" />
          </div>
          <Button
            size="sm"
            disabled={!addUser}
            loading={busy === 'add'}
            onClick={async () => {
              if (await call('add', `/api/knowledge/departments/${department.id}/members`, 'POST', { userId: addUser })) setAddUser('')
            }}
          >
            <span className="inline-flex items-center gap-1.5"><UserPlus size={13} /> Add</span>
          </Button>
        </div>
        {members.length > 0 && (
          <ul className="mt-4 divide-y divide-[#f0efec] rounded-lg border border-[#e5e3df]">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900">{m.name}</p>
                  <p className="truncate text-[11px] text-gray-500">
                    {m.email}
                    {m.status !== 'active' && <span className="ml-1.5 text-red-600">· deactivated</span>}
                    {m.status === 'active' && !m.canAccess && <span className="ml-1.5 text-amber-700">· Knowledge Base not enabled on their account</span>}
                  </p>
                </div>
                <button
                  onClick={() => call(`rm-${m.id}`, `/api/knowledge/departments/${department.id}/members?userId=${m.id}`, 'DELETE')}
                  disabled={busy === `rm-${m.id}`}
                  className="text-gray-400 hover:text-red-600"
                  title="Remove from department"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title="Archive this department?"
        description="Its knowledge is kept, but nobody can browse it or get answers from it until you unarchive it."
        confirmLabel="Archive"
        loading={busy === 'archive'}
        onConfirm={async () => {
          if (await call('archive', `/api/knowledge/departments/${department.id}`, 'PATCH', { archived: true })) setConfirmArchive(false)
        }}
      />
    </div>
  )
}
