'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { FolderKanban } from 'lucide-react'
import Button from '@/components/ui/Button'
import NewProjectModal from '@/components/finance/NewProjectModal'
import { countryFlag } from '@/lib/country-flags'
import type { FinanceProject } from '@/types'

type ProjectRow = FinanceProject & {
  balance: number
  totalFunded: number
  verifiedSpend: number
  pendingSpend: number
  pendingCount: number
  finance_project_members: { project_role: string; profiles: { full_name: string | null; email: string } }[]
}

export default function FinanceAdminOverviewPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/finance/projects')
      .then(r => r.json())
      .then(d => setProjects(d.projects ?? []))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex justify-between items-start flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Overview</h1>
          <p className="text-sm text-gray-500 mt-1">All active projects and what&apos;s waiting on you.</p>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>New project</Button>
      </div>

      {/* Portfolio-wide numbers (active projects, outstanding funds, pending
          review, total projects) live on the Analytics tab now — this page
          is purely "here are my projects," same as the field "My Projects"
          view, just with a director/pending badge instead of a balance-only
          card. */}
      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="border border-dashed border-[#d8d5cf] bg-white/60 rounded-xl p-12 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mb-4">
            <FolderKanban size={24} />
          </div>
          <div className="text-sm font-medium text-gray-700">No projects yet</div>
          <p className="text-sm text-gray-500 mt-1">Create one to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {projects.map(p => {
            const director = p.finance_project_members?.find(m => m.project_role === 'director')
            const symbol = p.settlement_currency === 'USD' ? '$' : '€'
            return (
              <Link
                key={p.id}
                href={`/finance/admin/projects/${p.id}`}
                className="block bg-white border border-[#e5e3df] rounded-xl p-5 hover:border-gray-400 transition-colors"
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-2xl leading-none flex-shrink-0" aria-hidden="true">{countryFlag(p.country)}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-[15px] text-gray-900 truncate">{p.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {p.country} · {director?.profiles?.full_name || director?.profiles?.email || 'No director'}
                      </div>
                    </div>
                  </div>
                  {p.pendingCount > 0 ? (
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 flex-shrink-0">{p.pendingCount} pending</span>
                  ) : (
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">Clear</span>
                  )}
                </div>
                <div className="mt-4 flex justify-between items-end gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Balance</div>
                    <div className="text-2xl font-semibold tabular-nums text-gray-900">{symbol}{p.balance.toFixed(2)}</div>
                  </div>
                  <div className="text-right text-[11px] text-gray-500 leading-relaxed">
                    {symbol}{p.verifiedSpend.toFixed(2)} verified<br />
                    {symbol}{p.totalFunded.toFixed(2)} received
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={load} />
    </div>
  )
}
