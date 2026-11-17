'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { normalizeAgencyCode, suggestAgencyCode } from '@/lib/agencies'
import type { Agency } from '@/types'

// The central agency list (Admin → Agencies), opened from every module's
// admin area. Same look as the Media Library manager.

const inputClass =
  'w-full border border-[#e5e3df] bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-black focus:outline-none'
const labelClass = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-gray-500'

export default function AgencyManager({ initialAgencies }: { initialAgencies: Agency[] }) {
  const [agencies, setAgencies] = useState(initialAgencies)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Agency | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  async function call(url: string, method: string, body?: unknown) {
    setError(null)
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return null
    }
    return data
  }

  async function add() {
    setAdding(true)
    const data = await call('/api/agencies', 'POST', { name, code })
    setAdding(false)
    if (data?.agency) {
      setAgencies([...agencies, data.agency])
      setName('')
      setCode('')
      setCodeTouched(false)
    }
  }

  async function patch(a: Agency, body: Record<string, unknown>) {
    const data = await call(`/api/agencies/${a.id}`, 'PATCH', body)
    if (data?.agency) setAgencies((list) => list.map((x) => (x.id === a.id ? data.agency : x)))
  }

  return (
    <div className="flex flex-col gap-6">
      <Modal
        open={Boolean(deleting)}
        onClose={() => !busyDelete && setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          setBusyDelete(true)
          const ok = await call(`/api/agencies/${deleting.id}`, 'DELETE')
          setBusyDelete(false)
          if (ok) setAgencies((list) => list.filter((x) => x.id !== deleting.id))
          setDeleting(null)
        }}
        title={`Delete ${deleting?.name ?? ''}?`}
        description="Only an agency that nothing uses can be deleted. One used by existing projects, letters or templates can only be deactivated."
        confirmLabel="Delete agency"
        loading={busyDelete}
      />

      {error && <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="border border-[#e5e3df] bg-white">
        <div className="hidden grid-cols-[1fr_6rem_5rem_2rem] gap-3 border-b border-[#e5e3df] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500 md:grid">
          <span>Name</span>
          <span>Code</span>
          <span>Active</span>
          <span />
        </div>
        {agencies.length === 0 && <p className="px-4 py-6 text-sm text-gray-500">No agencies yet.</p>}
        <ul className="divide-y divide-[#efede9]">
          {agencies.map((a) => (
            <li key={a.id} className="grid grid-cols-1 items-center gap-3 px-4 py-3 md:grid-cols-[1fr_6rem_5rem_2rem]">
              <span className={`text-sm ${a.active ? 'text-gray-900' : 'text-gray-400'}`}>{a.name}</span>
              <span className="font-mono text-sm text-gray-700" title="The code modules store. It can't be changed.">
                {a.code}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={a.active} onChange={(e) => patch(a, { active: e.target.checked })} /> Active
              </label>
              <button type="button" aria-label={`Delete ${a.name}`} onClick={() => setDeleting(a)} className="justify-self-start p-1.5 text-gray-300 transition-colors hover:text-red-500 md:justify-self-end">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="border border-[#e5e3df] bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Add an agency</h2>
        <div className="grid gap-4 md:grid-cols-[1fr_8rem]">
          <div>
            <label htmlFor="agency-name" className={labelClass}>
              Name
            </label>
            <input
              id="agency-name"
              className={inputClass}
              value={name}
              placeholder="e.g. Asia Business Reports"
              onChange={(e) => {
                setName(e.target.value)
                if (!codeTouched) setCode(suggestAgencyCode(e.target.value))
              }}
            />
          </div>
          <div>
            <label htmlFor="agency-code" className={labelClass}>
              Code
            </label>
            <input
              id="agency-code"
              className={`${inputClass} font-mono`}
              value={code}
              placeholder="ABR"
              onChange={(e) => {
                setCodeTouched(true)
                setCode(normalizeAgencyCode(e.target.value))
              }}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">The code is what every tool stores (2–12 capital letters or digits). It can&apos;t be changed after the agency is created.</p>
        <div className="mt-4">
          <Button size="sm" loading={adding} disabled={!name.trim() || code.length < 2} onClick={add}>
            <Plus size={13} className="mr-1.5 inline" /> Add agency
          </Button>
        </div>
      </section>
    </div>
  )
}
