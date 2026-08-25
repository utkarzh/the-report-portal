'use client'

import { useEffect, useState, useCallback } from 'react'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import Input from '@/components/ui/Input'

interface Project { id: string; name: string; settlement_currency: string }
interface Transfer {
  id: string
  amount: number
  reason: string
  created_at: string
  from_project: { name: string; settlement_currency: string }
  to_project: { name: string; settlement_currency: string }
}

// Brief J-01: move funds between a Director's own projects (e.g. India tops
// up Pakistan) while both stay fully independent ledgers — see
// computeBalance's transfersIn/transfersOut in src/lib/finance.ts.
export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ fromProjectId: '', toProjectId: '', amount: '', reason: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/finance/transfers').then(r => r.json()),
      fetch('/api/finance/projects').then(r => r.json()),
    ]).then(([t, p]) => {
      setTransfers(t.transfers ?? [])
      setProjects(p.projects ?? [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await fetch('/api/finance/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to record the transfer.')
      setSubmitting(false)
      return
    }
    setForm({ fromProjectId: '', toProjectId: '', amount: '', reason: '' })
    setSubmitting(false)
    load()
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Inter-project transfers</h1>
        <p className="text-sm text-gray-500 mt-1">Move funds between a Director&apos;s projects while keeping both ledgers fully independent.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-[#e5e3df] rounded-xl p-5 mb-8">
        {error && <div className="p-2.5 mb-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <Select
            label="From project"
            options={projects.map(p => ({ value: p.id, label: p.name }))}
            value={form.fromProjectId}
            onChange={e => setForm(f => ({ ...f, fromProjectId: e.target.value }))}
            placeholder="Select…"
          />
          <Select
            label="To project"
            options={projects.filter(p => p.id !== form.fromProjectId).map(p => ({ value: p.id, label: p.name }))}
            value={form.toProjectId}
            onChange={e => setForm(f => ({ ...f, toProjectId: e.target.value }))}
            placeholder="Select…"
          />
          <Input
            label="Amount"
            type="number"
            step="0.01"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            required
          />
          <Button type="submit" size="sm" loading={submitting}>Transfer</Button>
        </div>
        <div className="mt-3">
          <Input
            label="Reason"
            value={form.reason}
            onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
            placeholder="e.g. India fund topping up Pakistan for an urgent expense"
          />
        </div>
      </form>

      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">History</div>
      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : transfers.length === 0 ? (
        <div className="border border-[#e5e3df] bg-white rounded-xl p-6 text-sm text-gray-500">No transfers yet.</div>
      ) : (
        <div className="bg-white border border-[#e5e3df] rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-gray-400 border-b border-[#e5e3df]">
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">From</th>
                <th className="px-4 py-2.5">To</th>
                <th className="px-4 py-2.5">Reason</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map(t => (
                <tr key={t.id} className="border-b border-[#e5e3df] last:border-0">
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">{t.created_at.slice(0, 10)}</td>
                  <td className="px-4 py-3">{t.from_project?.name}</td>
                  <td className="px-4 py-3">{t.to_project?.name}</td>
                  <td className="px-4 py-3 text-gray-500">{t.reason || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {t.to_project?.settlement_currency === 'USD' ? '$' : '€'}{Number(t.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
