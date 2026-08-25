'use client'

import { useEffect, useState } from 'react'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceProject } from '@/types'

interface Analytics {
  totalVerifiedSpend: number
  receiptsProcessed: number
  flaggedCount: number
  flagRate: number
  spendByCategory: Record<string, number>
  spendByProject: Record<string, number>
}

type ProjectRow = FinanceProject & {
  balance: number
  pendingSpend: number
  finance_project_members: { project_role: string; profiles: { full_name: string | null; email: string } }[]
}

export default function FinanceAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null)
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)

  useEffect(() => {
    fetch('/api/finance/analytics').then(r => r.json()).then(setData)
    fetch('/api/finance/projects').then(r => r.json()).then(d => setProjects(d.projects ?? []))
  }, [])

  if (!data || !projects) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  const categoryMax = Math.max(...Object.values(data.spendByCategory), 1)
  const projectMax = Math.max(...Object.values(data.spendByProject), 1)

  // Portfolio-level counts — moved here from the Overview page, which is now
  // purely the project list (see finance/admin/page.tsx).
  const activeCount = projects.filter(p => p.status === 'active').length
  const outstandingBalance = projects.reduce((sum, p) => sum + p.balance, 0)
  const pendingTotal = projects.reduce((sum, p) => sum + p.pendingSpend, 0)
  const directors = new Set(
    projects.flatMap(p => p.finance_project_members?.filter(m => m.project_role === 'director').map(m => m.profiles?.email) ?? []),
  ).size

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Spend across projects.</p>
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Portfolio</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { k: 'Active projects', v: String(activeCount), d: `${directors} director${directors === 1 ? '' : 's'}` },
          { k: 'Funds outstanding', v: `$${outstandingBalance.toFixed(2)}`, d: 'unspent director balances' },
          { k: 'Pending review (face value)', v: `$${pendingTotal.toFixed(2)}`, d: 'across all projects' },
          { k: 'Total projects', v: String(projects.length), d: 'incl. closed' },
        ].map(kpi => (
          <div key={kpi.k} className="bg-white border border-[#e5e3df] rounded-xl p-4">
            <div className="text-[10.5px] uppercase tracking-wide text-gray-400">{kpi.k}</div>
            <div className="text-xl font-semibold mt-1 tabular-nums text-gray-900">{kpi.v}</div>
            <div className="text-xs text-gray-500 mt-0.5">{kpi.d}</div>
          </div>
        ))}
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Spend</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        {[
          { k: 'Total verified spend', v: `$${data.totalVerifiedSpend.toFixed(2)}` },
          { k: 'Receipts processed', v: String(data.receiptsProcessed) },
          { k: 'Flag rate', v: `${Math.round(data.flagRate * 100)}%`, d: `${data.flaggedCount} of ${data.receiptsProcessed} flagged` },
        ].map(kpi => (
          <div key={kpi.k} className="bg-white border border-[#e5e3df] rounded-xl p-4">
            <div className="text-[10.5px] uppercase tracking-wide text-gray-400">{kpi.k}</div>
            <div className="text-xl font-semibold mt-1 tabular-nums text-gray-900">{kpi.v}</div>
            {kpi.d && <div className="text-xs text-gray-500 mt-0.5">{kpi.d}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="bg-white border border-[#e5e3df] rounded-xl p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-4">Spend by category</div>
          <div className="flex flex-col gap-3.5">
            {Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS).map(([key, label]) => {
              const value = data.spendByCategory[key] || 0
              return (
                <div key={key}>
                  <div className="flex justify-between text-[13px] mb-1">
                    <span>{label}</span>
                    <span className="tabular-nums">${value.toFixed(2)}</span>
                  </div>
                  <div className="h-[5px] bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-black rounded-full" style={{ width: `${(value / categoryMax) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-white border border-[#e5e3df] rounded-xl p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-4">Spend by project</div>
          <div className="flex flex-col gap-3.5">
            {Object.entries(data.spendByProject).length === 0 ? (
              <div className="text-sm text-gray-400">No verified spend yet.</div>
            ) : Object.entries(data.spendByProject).map(([name, value]) => (
              <div key={name}>
                <div className="flex justify-between text-[13px] mb-1">
                  <span>{name}</span>
                  <span className="tabular-nums">${value.toFixed(2)}</span>
                </div>
                <div className="h-[5px] bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-black rounded-full" style={{ width: `${(value / projectMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
