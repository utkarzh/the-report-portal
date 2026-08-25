'use client'

import { useState, useEffect } from 'react'
import { X, Plus } from 'lucide-react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import SearchableSelect from '@/components/ui/SearchableSelect'
import Button from '@/components/ui/Button'
import { COUNTRY_OPTIONS } from '@/lib/country-flags'

interface FinanceUser {
  id: string
  full_name: string | null
  email: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const defaultForm = {
  name: '',
  country: '',
  settlementCurrency: 'USD',
  exchangeRate: '',
  localCurrency: '',
  mediaPublication: '',
  directorUserId: '',
  aiRules: '',
}

export default function NewProjectModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState(defaultForm)
  const [reps, setReps] = useState<string[]>([]) // additional sales-rep user ids, added at creation time
  const [users, setUsers] = useState<FinanceUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { setForm(defaultForm); setReps([]); setError(null); return }
    fetch('/api/finance/users')
      .then(r => r.json())
      .then(d => setUsers(d.users ?? []))
      .catch(() => setUsers([]))
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const res = await fetch('/api/finance/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, salesRepUserIds: reps.filter(Boolean) }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to create project.')
      setLoading(false)
      return
    }

    setLoading(false)
    onCreated()
    onClose()
  }

  const userLabel = (u: FinanceUser) => `${u.full_name || u.email} · ${u.email}`
  const availableForReps = users.filter(u => u.id !== form.directorUserId)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl flex flex-col rounded-xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df] sticky top-0 bg-white">
          <h2 className="text-sm font-semibold text-gray-900">New project</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 flex flex-col gap-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded">{error}</div>}

          <Input
            label="Project name *"
            placeholder="e.g. India — The Guardian 2026"
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            required
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SearchableSelect
              label="Country"
              required
              options={COUNTRY_OPTIONS.map(c => ({ value: c.name, label: c.name, icon: c.flag }))}
              value={form.country}
              onChange={v => setForm(p => ({ ...p, country: v }))}
              placeholder="Select a country…"
              searchPlaceholder="Search countries…"
            />
            <Input
              label="Local currency"
              placeholder="INR"
              value={form.localCurrency}
              onChange={e => setForm(p => ({ ...p, localCurrency: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Settlement currency *"
              options={[{ value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }]}
              value={form.settlementCurrency}
              onChange={e => setForm(p => ({ ...p, settlementCurrency: e.target.value }))}
              placeholder=""
            />
            <Input
              label="Exchange rate *"
              type="number"
              step="0.0001"
              placeholder="83.20"
              value={form.exchangeRate}
              onChange={e => setForm(p => ({ ...p, exchangeRate: e.target.value }))}
              required
            />
          </div>
          <Input
            label="Media / publication"
            placeholder="The Guardian"
            value={form.mediaPublication}
            onChange={e => setForm(p => ({ ...p, mediaPublication: e.target.value }))}
          />

          <Select
            label="Director (financially accountable) *"
            options={users.map(u => ({ value: u.id, label: userLabel(u) }))}
            value={form.directorUserId}
            onChange={e => setForm(p => ({ ...p, directorUserId: e.target.value }))}
            placeholder="Select from your team…"
          />

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">
              Sales reps (optional — more can be added later)
            </label>
            <div className="flex flex-col gap-2">
              {reps.map((repId, i) => (
                <div key={i} className="flex gap-2">
                  <select
                    className="flex-1 text-sm border border-[#e5e3df] rounded-lg px-3 py-2"
                    value={repId}
                    onChange={e => setReps(prev => prev.map((r, idx) => idx === i ? e.target.value : r))}
                  >
                    <option value="">Select…</option>
                    {availableForReps.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                  </select>
                  <button type="button" onClick={() => setReps(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-600 px-2">
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setReps(prev => [...prev, ''])}
                className="text-xs font-medium text-gray-600 hover:text-black flex items-center gap-1 self-start"
              >
                <Plus size={13} /> Add a sales rep
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">
              AI checking rules (optional)
            </label>
            <textarea
              className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 min-h-[80px]"
              placeholder={'e.g. "Don\'t count expenses logged on Saturday or Sunday for this project." / "Flag any taxi expense over $40."'}
              value={form.aiRules}
              onChange={e => setForm(p => ({ ...p, aiRules: e.target.value }))}
            />
            <p className="text-[11px] text-gray-500 mt-1.5">
              Plain-English rules specific to this project. The AI treats these as strict requirements
              when reading receipts and flags anything that breaks them — on top of the standard checks
              (duplicates, weekend dates, budget caps) that already run on every project.
            </p>
          </div>

          <p className="text-xs text-gray-500">
            One country per project (tax requirement). Only accounts with Finance access already
            enabled (Admin → Users → Edit) appear here.
          </p>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={loading} arrow>
              Create project
            </Button>
            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
