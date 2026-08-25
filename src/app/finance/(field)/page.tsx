export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { computeBalance } from '@/lib/finance'
import { countryFlag } from '@/lib/country-flags'
import type { FinanceExpense, FinanceFunding, FinanceProject, FinanceTransfer } from '@/types'

export default async function MyProjectsPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  // Explicit membership scoping, not just RLS — mirrors the admin overview's
  // own defensive pattern (see GET /api/finance/projects) so "which projects
  // does this field user see" is never a single point of failure.
  const { data: memberships } = await supabase
    .from('finance_project_members')
    .select('project_id')
    .eq('user_id', profile.id)
  const memberProjectIds = (memberships ?? []).map(m => m.project_id)

  const { data: projects } = memberProjectIds.length
    ? await supabase
        .from('finance_projects')
        .select('*')
        .in('id', memberProjectIds)
        .order('created_at', { ascending: false })
    : { data: [] as FinanceProject[] }

  const list = (projects ?? []) as FinanceProject[]
  const ids = list.map(p => p.id)

  const { data: fundings } = ids.length
    ? await supabase.from('finance_fundings').select('*').in('project_id', ids)
    : { data: [] as FinanceFunding[] }
  const { data: expenses } = ids.length
    ? await supabase.from('finance_expenses').select('*').in('project_id', ids)
    : { data: [] as FinanceExpense[] }
  const { data: transfers } = ids.length
    ? await supabase.from('finance_transfers').select('*')
    : { data: [] as FinanceTransfer[] }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">My Projects</h1>
        <p className="text-sm text-gray-500 mt-1">Projects you&apos;ve been added to by Finance.</p>
      </div>

      {list.length === 0 ? (
        <div className="border border-[#e5e3df] bg-white rounded-xl p-8 text-center text-sm text-gray-500">
          You haven&apos;t been added to a project yet. Ask Finance to add you.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {list.map(project => {
            const pf = (fundings ?? []).filter((f: FinanceFunding) => f.project_id === project.id)
            const pe = (expenses ?? []).filter((e: FinanceExpense) => e.project_id === project.id)
            const tIn = (transfers ?? []).filter((t: FinanceTransfer) => t.to_project_id === project.id)
            const tOut = (transfers ?? []).filter((t: FinanceTransfer) => t.from_project_id === project.id)
            const { balance, totalFunded, pendingSpend } = computeBalance(pf, pe, tIn, tOut)
            const pendingCount = pe.filter((e: FinanceExpense) => e.status === 'pending').length
            return (
              <Link
                key={project.id}
                href={`/finance/${project.id}`}
                className="block bg-white border border-[#e5e3df] rounded-xl p-5 hover:border-gray-400 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl leading-none" aria-hidden="true">{countryFlag(project.country)}</span>
                    <div>
                      <div className="font-semibold text-[15px] text-gray-900">{project.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{project.country} · {project.settlement_currency}</div>
                    </div>
                  </div>
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                    {project.status === 'active' ? 'Active' : 'Closed'}
                  </span>
                </div>
                <div className="mt-4 flex justify-between items-end">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Balance left</div>
                    <div className="text-2xl font-semibold tabular-nums text-gray-900">
                      {project.settlement_currency === 'USD' ? '$' : '€'}{balance.toFixed(2)}
                    </div>
                  </div>
                  {pendingCount > 0 && (
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                      {pendingCount} pending
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 mt-2">
                  {(totalFunded - balance - pendingSpend).toFixed(2)} of {totalFunded.toFixed(2)} verified spend
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
