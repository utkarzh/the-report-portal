'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

interface Dept {
  id: string
  name: string
  guardian_id: string | null
  archived_at: string | null
}

// Knowledge Base department membership, edited from the user's profile
// (US-099). Writes the same rows as the department page; each toggle saves
// straight away.
export default function UserKnowledgeDepartments({ userId }: { userId: string }) {
  const [departments, setDepartments] = useState<Dept[] | null>(null)
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/knowledge/users/${userId}/departments`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return
        setDepartments(data.departments)
        setMemberIds(new Set(data.memberIds))
      })
      .catch(() => !cancelled && setError('Couldn’t load departments.'))
    return () => {
      cancelled = true
    }
  }, [userId])

  async function toggle(id: string, on: boolean) {
    const next = new Set(memberIds)
    if (on) next.add(id)
    else next.delete(id)
    setMemberIds(next)
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/knowledge/users/${userId}/departments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ departmentIds: Array.from(next) }),
    })
    setSaving(false)
    if (!res.ok) {
      setError('Couldn’t save — try again.')
      setMemberIds(memberIds)
    }
  }

  const live = (departments || []).filter((d) => !d.archived_at)

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-[10px] text-gray-400">
        Knowledge Base departments {saving && <Loader2 size={10} className="animate-spin" />}
      </p>
      {departments === null && !error && <p className="text-xs text-gray-400">Loading…</p>}
      {departments !== null && live.length === 0 && <p className="text-xs text-gray-400">No departments yet — create them in Admin → Knowledge Base.</p>}
      {live.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {live.map((d) => (
            <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded border border-[#e5e3df] px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
              <input type="checkbox" className="accent-black" checked={memberIds.has(d.id)} onChange={(e) => toggle(d.id, e.target.checked)} />
              <span className="truncate">{d.name}</span>
              {d.guardian_id === userId && <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider text-[#a07530]">Guardian</span>}
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
