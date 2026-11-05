'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceProject } from '@/types'

interface CurrencySpend {
  totalVerifiedSpend: number
  spendByCategory: Record<string, number>
  spendByProject: Record<string, { name: string; closed: boolean; amount: number }>
}

interface Analytics {
  // Keyed by settlement currency (USD / EUR) — never added together.
  byCurrency: Record<string, CurrencySpend>
  receiptsProcessed: number
  flaggedCount: number
  flagRate: number
}

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€' }
const money = (currency: string, n: number) => `${SYMBOLS[currency] ?? `${currency} `}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// "$8,171.16 · €1,409.98" — one figure per settlement currency in use.
function perCurrency(totals: Record<string, number>): string {
  const entries = Object.entries(totals).filter(([, v]) => v !== 0)
  if (entries.length === 0) return money('USD', 0)
  return entries.sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => money(c, v)).join(' · ')
}

type ProjectRow = FinanceProject & {
  balance: number
  pendingSpend: number
  finance_project_members: { project_role: string; profiles: { full_name: string | null; email: string } }[]
}

export default function FinanceAnalyticsPage() {
  // In the URL, so a refresh or a shared link shows the same figures. Nothing
  // renders from it until the data arrives, so reading it here can't mismatch.
  const [includeClosed, setIncludeClosed] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('closed') === '1')
  const [data, setData] = useState<Analytics | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)

  useEffect(() => {
    fetch('/api/finance/projects').then(r => r.json()).then(d => setProjects(d.projects ?? []))
  }, [])

  // The old figures stay on screen, dimmed, until the new ones land. A quick
  // second switch cancels the first request, so it can't arrive last and win.
  useEffect(() => {
    const request = new AbortController()
    setRefreshing(true)
    fetch(`/api/finance/analytics${includeClosed ? '?includeClosed=1' : ''}`, { signal: request.signal })
      .then(r => r.json())
      .then(d => { setData(d); setRefreshing(false) })
      .catch(() => { /* cancelled by the next switch */ })
    return () => request.abort()
  }, [includeClosed])

  function chooseScope(next: boolean) {
    setIncludeClosed(next)
    window.history.replaceState(null, '', next ? '?closed=1' : window.location.pathname)
  }

  if (!data || !projects) return <div className="p-4 sm:p-8 text-sm text-gray-400">Loading…</div>

  const currencies = Object.keys(data.byCurrency).sort()

  // Portfolio-level counts — moved here from the Overview page, which is now
  // purely the project list (see finance/admin/page.tsx).
  const activeCount = projects.filter(p => p.status === 'active').length
  const closedCount = projects.length - activeCount
  const inScope = includeClosed ? projects : projects.filter(p => p.status === 'active')
  const sumBy = (pick: (p: ProjectRow) => number) => inScope.reduce<Record<string, number>>((acc, p) => {
    acc[p.settlement_currency] = (acc[p.settlement_currency] || 0) + pick(p)
    return acc
  }, {})
  const outstandingBalance = sumBy(p => p.balance)
  const pendingTotal = sumBy(p => p.pendingSpend)
  const verifiedTotals = Object.fromEntries(currencies.map(c => [c, data.byCurrency[c].totalVerifiedSpend]))
  const directors = new Set(
    inScope.flatMap(p => p.finance_project_members?.filter(m => m.project_role === 'director').map(m => m.profiles?.email) ?? []),
  ).size

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            {includeClosed ? 'Spend across all projects, including closed ones.' : 'Spend across active projects.'}
          </p>
        </div>
        {closedCount > 0 && (
          <div role="group" aria-label="Which projects to count" className="inline-flex rounded-xl border border-[#e5e3df] bg-white p-1 text-xs font-medium shadow-sm">
            {[
              { value: false, label: 'Active projects', count: activeCount },
              { value: true, label: 'Include closed', count: projects.length },
            ].map(o => (
              <button
                key={o.label}
                type="button"
                onClick={() => chooseScope(o.value)}
                aria-pressed={includeClosed === o.value}
                className={`rounded-lg px-3 py-1.5 touch:py-2.5 transition-colors ${includeClosed === o.value ? 'bg-black text-white' : 'text-gray-600 hover:text-black'}`}
              >
                {o.label} <span className={`tabular-nums ${includeClosed === o.value ? 'text-white/70' : 'text-gray-400'}`}>{o.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div aria-busy={refreshing} className={`transition-opacity ${refreshing ? 'opacity-50' : ''}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Portfolio</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { k: includeClosed ? 'Projects' : 'Active projects', v: String(inScope.length), d: `${directors} director${directors === 1 ? '' : 's'}` },
          { k: 'Funds outstanding', v: perCurrency(outstandingBalance), d: 'unspent director balances' },
          { k: 'Pending review (face value)', v: perCurrency(pendingTotal), d: includeClosed ? 'across all projects' : 'across active projects' },
          { k: 'Closed projects', v: String(closedCount), d: includeClosed ? 'included in these figures' : 'not included in these figures' },
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
          { k: 'Total verified spend', v: perCurrency(verifiedTotals) },
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

      {currencies.length === 0 && (
        <div className="text-sm text-gray-400">
          {includeClosed || closedCount === 0 ? 'No verified spend yet.' : 'No verified spend on active projects yet. Include closed projects to see earlier spend.'}
        </div>
      )}
      {currencies.map(currency => {
        const c = data.byCurrency[currency]
        const categoryMax = Math.max(...Object.values(c.spendByCategory), 1)
        const projectRows = Object.entries(c.spendByProject).sort(([, a], [, b]) => b.amount - a.amount)
        const projectMax = Math.max(...projectRows.map(([, p]) => p.amount), 1)
        return (
          <div key={currency} className="mb-8">
            {currencies.length > 1 && (
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">{currency} projects</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="bg-white border border-[#e5e3df] rounded-xl p-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-4">Spend by category</div>
                <div className="flex flex-col gap-3.5">
                  {Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS).map(([key, label]) => {
                    const value = c.spendByCategory[key] || 0
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-[13px] mb-1">
                          <span>{label}</span>
                          <span className="tabular-nums">{money(currency, value)}</span>
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
                  {projectRows.map(([id, p]) => (
                    <div key={id}>
                      <div className="flex justify-between gap-3 text-[13px] mb-1">
                        <span className="min-w-0">
                          <Link href={`/finance/admin/projects/${id}`} className="hover:underline">{p.name}</Link>
                          {p.closed && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Closed</span>}
                        </span>
                        <span className="flex-shrink-0 tabular-nums">{money(currency, p.amount)}</span>
                      </div>
                      <div className="h-[5px] bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${p.closed ? 'bg-gray-400' : 'bg-black'}`} style={{ width: `${(p.amount / projectMax) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}
