import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  WEB_SEARCH_PRICE_PER_REQUEST,
  PRICE_OUTPUT_PER_MILLION,
} from '@/lib/claude/tokens'
import { Activity, DollarSign, ArrowUpRight, ArrowDownLeft, Users, Search } from 'lucide-react'

export default async function AnalyticsPage() {
  requireAdminHeader()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

  const [{ data: sessions }, { data: users }] = await Promise.all([
    supabaseAdmin
      .from('research_sessions')
      .select('user_id, tokens_input, tokens_output, tokens_total, web_searches, cost_usd')
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd),
    supabaseAdmin
      .from('profiles')
      .select('id, full_name, email'),
  ])

  const totals = (sessions || []).reduce(
    (acc, s) => ({
      requests: acc.requests + 1,
      inputTokens: acc.inputTokens + (s.tokens_input || 0),
      outputTokens: acc.outputTokens + (s.tokens_output || 0),
      webSearches: acc.webSearches + (s.web_searches || 0),
      cost: acc.cost + Number(s.cost_usd || 0),
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, webSearches: 0, cost: 0 }
  )
  // Cost breakdown — total cost_usd in DB already includes input + output + cache + search.
  // We derive output and search costs from their exact per-unit prices and treat the
  // remainder as input cost (this absorbs the cache-tier price variations accurately).
  const outputCost = (totals.outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MILLION
  const webSearchCost = totals.webSearches * WEB_SEARCH_PRICE_PER_REQUEST
  const inputCost = Math.max(0, totals.cost - outputCost - webSearchCost)

  const userMap = Object.fromEntries((users || []).map(u => [u.id, u]))

  const perUser: Record<string, {
    fullName: string | null
    email: string
    requests: number
    inputTokens: number
    outputTokens: number
    webSearches: number
    cost: number
  }> = {}

  for (const s of (sessions || [])) {
    const key = s.user_id ?? '__deleted__'
    if (!perUser[key]) {
      const u = s.user_id ? userMap[s.user_id] : undefined
      perUser[key] = {
        fullName: u?.full_name || null,
        email: u?.email ?? 'Deleted user',
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        webSearches: 0,
        cost: 0,
      }
    }
    perUser[key].requests += 1
    perUser[key].inputTokens += s.tokens_input || 0
    perUser[key].outputTokens += s.tokens_output || 0
    perUser[key].webSearches += s.web_searches || 0
    perUser[key].cost += Number(s.cost_usd || 0)
  }

  const perUserList = Object.values(perUser).sort((a, b) => b.cost - a.cost)
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const maxCost = perUserList[0]?.cost || 1

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1.5">{monthLabel} — current month</p>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
          <StatCard
            label="Total Requests"
            value={totals.requests.toLocaleString()}
            icon={Activity}
          />
          <StatCard
            label="Total Cost"
            value={`$${totals.cost.toFixed(4)}`}
            sub={`$${inputCost.toFixed(4)} in + $${outputCost.toFixed(4)} out + $${webSearchCost.toFixed(4)} search`}
            icon={DollarSign}
          />
          <StatCard
            label="Input Tokens"
            value={formatTokens(totals.inputTokens)}
            sub="sent to Claude"
            icon={ArrowUpRight}
          />
          <StatCard
            label="Output Tokens"
            value={formatTokens(totals.outputTokens)}
            sub="received from Claude"
            icon={ArrowDownLeft}
          />
          <StatCard
            label="Web Searches"
            value={totals.webSearches.toLocaleString()}
            sub={`$${WEB_SEARCH_PRICE_PER_REQUEST.toFixed(2)} each — billed separately`}
            icon={Search}
          />
        </div>

        {/* Per-user breakdown */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Users size={14} className="text-gray-400" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
              Breakdown by User
            </h2>
          </div>
          {perUserList.length > 0 && (
            <span className="text-xs text-gray-400">{perUserList.length} user{perUserList.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {perUserList.length === 0 ? (
          <div className="bg-white border border-[#e5e3df] p-10 text-center">
            <Activity size={24} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No activity recorded this month.</p>
          </div>
        ) : (
          <div className="bg-white border border-[#e5e3df] overflow-x-auto">
            <table className="w-full text-xs min-w-[540px]">
              <thead>
                <tr className="border-b border-[#e5e3df] bg-[#f9f8f6]">
                  <th className="text-left px-5 py-3.5 font-semibold uppercase tracking-widest text-gray-400">User</th>
                  <th className="text-right px-5 py-3.5 font-semibold uppercase tracking-widest text-gray-400">Requests</th>
                  <th className="text-right px-5 py-3.5 font-semibold uppercase tracking-widest text-gray-400">Input</th>
                  <th className="text-right px-5 py-3.5 font-semibold uppercase tracking-widest text-gray-400">Output</th>
                  <th className="text-right px-5 py-3.5 font-semibold uppercase tracking-widest text-gray-400">Searches</th>
                  <th className="text-right px-5 py-3.5 font-semibold uppercase tracking-widest text-gray-400">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e3df]">
                {perUserList.map((u, i) => (
                  <tr key={i} className="hover:bg-[#f9f8f6] transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[11px] font-semibold text-gray-500 flex-shrink-0">
                          {(u.fullName || u.email)[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">{u.fullName || u.email}</p>
                          {u.fullName && <p className="text-gray-400 mt-0.5 truncate">{u.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right text-gray-600 tabular-nums">{u.requests}</td>
                    <td className="px-5 py-4 text-right text-gray-600 tabular-nums">{formatTokens(u.inputTokens)}</td>
                    <td className="px-5 py-4 text-right text-gray-600 tabular-nums">{formatTokens(u.outputTokens)}</td>
                    <td className="px-5 py-4 text-right text-gray-600 tabular-nums">{u.webSearches}</td>
                    <td className="px-5 py-4 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-3">
                        <div className="w-16 h-1 bg-gray-100 rounded-full overflow-hidden hidden sm:block">
                          <div
                            className="h-full bg-black rounded-full"
                            style={{ width: `${(u.cost / maxCost) * 100}%` }}
                          />
                        </div>
                        <span className="font-medium text-gray-900">${u.cost.toFixed(4)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Totals footer */}
              {perUserList.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-[#e5e3df] bg-[#f9f8f6]">
                    <td className="px-5 py-3.5 text-xs font-semibold uppercase tracking-widest text-gray-500">Total</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-900 tabular-nums">{totals.requests}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-900 tabular-nums">{formatTokens(totals.inputTokens)}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-900 tabular-nums">{formatTokens(totals.outputTokens)}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-900 tabular-nums">{totals.webSearches}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-900 tabular-nums">${totals.cost.toFixed(4)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

      </div>
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string
  icon: React.ElementType
  sub?: string
}

function StatCard({ label, value, icon: Icon, sub }: StatCardProps) {
  return (
    <div className="bg-white border border-[#e5e3df] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={15} strokeWidth={1.5} className="text-gray-400 flex-shrink-0" />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 leading-tight">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1.5 uppercase tracking-wide">{sub}</p>}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
