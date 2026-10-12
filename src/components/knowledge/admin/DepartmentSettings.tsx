'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, Search, UserMinus, UserPlus } from 'lucide-react'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { Avatar } from '@/components/knowledge/kb-ui'
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
  columns = false,
}: {
  department: KnowledgeDepartment
  users: UserOption[]
  members: MemberRow[]
  guardianWarning: string | null
  // Settings and members side by side (wide layouts) instead of stacked.
  columns?: boolean
}) {
  const router = useRouter()
  const [name, setName] = useState(department.name)
  const [description, setDescription] = useState(department.description)
  const [guardianId, setGuardianId] = useState(department.guardian_id ?? '')
  const [addUser, setAddUser] = useState('')
  const [memberFilter, setMemberFilter] = useState('')
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
  const q = memberFilter.trim().toLowerCase()
  const shownMembers = q ? members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) : members
  const changed = name !== department.name || description !== department.description || guardianId !== (department.guardian_id ?? '')

  const span = columns ? 'lg:col-span-2' : ''

  return (
    <div className={columns ? 'grid items-start gap-5 lg:grid-cols-2' : 'flex flex-col gap-5'}>
      {guardianWarning && (
        <p className={`flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 ${span}`}>
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {guardianWarning}
        </p>
      )}
      {error && <p className={`rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 ${span}`}>{error}</p>}

      <section className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
        <div className="border-b border-[#eceae5] px-5 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Department settings</p>
        </div>
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await call('save', `/api/knowledge/departments/${department.id}`, 'PATCH', { name, description, guardianId: guardianId || null })) setSaved(true)
          }}
        >
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Textarea label="Short description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          <div>
            <SearchableSelect
              label="Guardian"
              options={[{ value: '', label: '— No Guardian (read-only) —' }, ...users]}
              value={guardianId}
              onChange={setGuardianId}
              searchPlaceholder="Search users…"
            />
            <p className="mt-1.5 text-[11px] leading-4 text-gray-400">Changing the Guardian moves this department’s drafts and open suggestions to the new Guardian.</p>
          </div>
          <div className="flex items-center gap-3 border-t border-[#f0efec] pt-4">
            <Button type="submit" size="sm" loading={busy === 'save'} disabled={!changed}>
              Save changes
            </Button>
            {saved && !changed && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 size={12} /> Saved
              </span>
            )}
            <button
              type="button"
              onClick={() => (archived ? call('archive', `/api/knowledge/departments/${department.id}`, 'PATCH', { archived: false }) : setConfirmArchive(true))}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-black"
            >
              {archived ? (
                <>
                  <ArchiveRestore size={13} /> Unarchive
                </>
              ) : (
                <>
                  <Archive size={13} /> Archive department
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#eceae5] px-5 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Members <span className="font-medium text-gray-300">{members.length}</span>
          </p>
        </div>
        <div className="p-5">
          <p className="mb-4 text-[11px] leading-4 text-gray-500">Members can browse this department’s published knowledge, and the AI uses it to answer them. The Guardian always has access.</p>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <SearchableSelect label="Add a person" options={addable} value={addUser} onChange={setAddUser} placeholder="Choose a user…" searchPlaceholder="Search users…" />
            </div>
            <Button
              size="sm"
              disabled={!addUser}
              loading={busy === 'add'}
              onClick={async () => {
                if (await call('add', `/api/knowledge/departments/${department.id}/members`, 'POST', { userId: addUser })) setAddUser('')
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <UserPlus size={13} /> Add
              </span>
            </Button>
          </div>

          {members.length > 6 && (
            <div className="relative mt-4">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                placeholder="Find a member"
                className="w-full rounded-lg border border-[#e5e3df] bg-[#faf9f7] py-2 pl-8 pr-3 text-xs placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none"
              />
            </div>
          )}

          {members.length === 0 ? (
            <p className="mt-4 rounded-xl bg-[#faf9f7] px-4 py-5 text-center text-xs text-gray-500">No members yet — add the people who should see this department’s knowledge.</p>
          ) : (
            <ul className="mt-4 max-h-[420px] divide-y divide-[#f0efec] overflow-y-auto rounded-xl border border-[#e5e3df]">
              {shownMembers.map((m) => (
                <li key={m.id} className="group flex items-center gap-3 px-3 py-2.5">
                  <Avatar name={m.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-900">{m.name}</p>
                    <p className="truncate text-[11px] text-gray-500">
                      {m.email}
                      {m.status !== 'active' && <span className="ml-1.5 text-red-600">· deactivated</span>}
                      {m.status === 'active' && !m.canAccess && <span className="ml-1.5 text-amber-700">· Knowledge Base not enabled on their account</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => call(`rm-${m.id}`, `/api/knowledge/departments/${department.id}/members?userId=${m.id}`, 'DELETE')}
                    disabled={busy === `rm-${m.id}`}
                    className="rounded-md p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-600 group-hover:text-gray-400"
                    title="Remove from department"
                  >
                    <UserMinus size={14} />
                  </button>
                </li>
              ))}
              {shownMembers.length === 0 && <li className="px-3 py-4 text-center text-xs text-gray-400">No members match.</li>}
            </ul>
          )}
        </div>
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
