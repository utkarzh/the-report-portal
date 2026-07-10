import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  WEB_SEARCH_PRICE_PER_REQUEST,
  PRICE_OUTPUT_PER_MILLION,
} from '@/lib/claude/tokens'
import { Activity, DollarSign, ArrowUpRight, ArrowDownLeft, Users, Search, TrendingUp, Layers } from 'lucide-react'
import type { UsageWorkflow } from '@/types'

// Analytics now reads the append-only usage_events ledger (see migration 010),
// NOT the mutable research_sessions row. So it counts every regeneration and
// includes transcription (refine/translate) Claude spend — both previously lost.

interface SearchParams {
  range?: string
}

const RANGES = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'all', label: 'All time' },
] as const

type RangeKey = (typeof RANGES)[number]['key']

const WORKFLOW_LABELS: Record<UsageWorkflow, string> = {
  research: 'Research',
  research_questions: 'Interview questions',
  transcript_refine: 'Transcript refine',
  transcript_translate: 'Transcript translate',
}
const WORKFLOW_ORDER: UsageWorkflow[] = ['research', 'research_questions', 'transcript_refine', 'transcript_translate']

// Resolves a range key to concrete bounds + how the trend should be bucketed.
// `start`/`end` are ISO strings (null start = "from the beginning").
function resolveRange(key: RangeKey): { start: string | null; end: string | null; label: string; bucket: 'day' | 'month' } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  if (key === 'last_month') {
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 0, 23, 59, 59)
    return { start: start.toISOString(), end: end.toISOString(), label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), bucket: 'day' }
  }
  if (key === 'last_30') {
    const start = new Date(now)
    start.setDate(start.getDate() - 29)
    start.setHours(0, 0, 0, 0)
    return { start: start.toISOString(), end: now.toISOString(), label: 'Last 30 days', bucket: 'day' }
  }
  if (key === 'all') {
    return { start: null, end: null, label: 'All time', bucket: 'month' }
  }
  // this_month (default)
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 0, 23, 59, 59)
  return { start: start.toISOString(), end: end.toISOString(), label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), bucket: 'day' }
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7)
}

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  requireAdminHeader()

  const rangeKey: RangeKey = RANGES.some(r => r.key === searchParams.range)
    ? (searchParams.range as RangeKey)
    : 'this_month'
  const { start, end, label, bucket } = resolveRange(rangeKey)

  let eventsQuery = supabaseAdmin
    .from('usage_events')
    .select('user_id, workflow, tokens_input, tokens_output, tokens_total, web_searches, cost_usd, status, created_at')
  if (start) eventsQuery = eventsQuery.gte('created_at', start)
  if (end) eventsQuery = eventsQuery.lte('created_at', end)

  const [{ data: events }, { data: users }] = await Promise.all([
    eventsQuery,
    supabaseAdmin.from('profiles').select('id, full_name, email'),
  ])

  const rows = events || []

  // ---- Totals ----
  const totals = rows.reduce(
    (acc, e) => ({
      requests: acc.requests + 1,
      inputTokens: acc.inputTokens + (e.tokens_input || 0),
      outputTokens: acc.outputTokens + (e.tokens_output || 0),
      webSearches: acc.webSearches + (e.web_searches || 0),
      cost: acc.cost + Number(e.cost_usd || 0),
      errors: acc.errors + (e.status === 'error' ? 1 : 0),
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, webSearches: 0, cost: 0, errors: 0 },
  )
  const outputCost = (totals.outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MILLION
  const webSearchCost = totals.webSearches * WEB_SEARCH_PRICE_PER_REQUEST
  const inputCost = Math.max(0, totals.cost - outputCost - webSearchCost)

  // ---- By workflow ----
  const byWorkflow = WORKFLOW_ORDER.map((wf) => {
    const wfRows = rows.filter((r) => r.workflow === wf)
    return {
      workflow: wf,
      label: WORKFLOW_LABELS[wf],
      requests: wfRows.length,
      cost: wfRows.reduce((s, r) => s + Number(r.cost_usd || 0), 0),
      tokens: wfRows.reduce((s, r) => s + (r.tokens_total || 0), 0),
    }
  }).filter((w) => w.requests > 0)
  const maxWorkflowCost = Math.max(...byWorkflow.map((w) => w.cost), 0.000001)

  // ---- Trend (cost over time) ----
  const bucketMap = new Map<string, { cost: number; requests: number }>()
  for (const r of rows) {
    const d = new Date(r.created_at)
    const key = bucket === 'day' ? dayKey(d) : monthKey(d)
    const cur = bucketMap.get(key) || { cost: 0, requests: 0 }
    cur.cost += Number(r.cost_usd || 0)
    cur.requests += 1
    bucketMap.set(key, cur)
  }
  // Build an ordered, gap-filled list of buckets across the range.
  const trend: { key: string; label: string; cost: number; requests: number }[] = []
  const rangeStart = start
    ? new Date(start)
    : rows.length
    ? new Date(rows.reduce((min, r) => (r.created_at < min ? r.created_at : min), rows[0].created_at))
    : new Date()
  const rangeEnd = end ? new Date(end) : new Date()
  if (bucket === 'day') {
    const cur = new Date(rangeStart)
    cur.setHours(0, 0, 0, 0)
    while (cur <= rangeEnd) {
      const key = dayKey(cur)
      const v = bucketMap.get(key) || { cost: 0, requests: 0 }
      trend.push({ key, label: cur.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), ...v })
      cur.setDate(cur.getDate() + 1)
    }
  } else {
    const cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
    while (cur <= rangeEnd) {
      const key = monthKey(cur)
      const v = bucketMap.get(key) || { cost: 0, requests: 0 }
      trend.push({ key, label: cur.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), ...v })
      cur.setMonth(cur.getMonth() + 1)
    }
  }
  const maxTrendCost = Math.max(...trend.map((t) => t.cost), 0.000001)

  // ---- By user ----
  const userMap = Object.fromEntries((users || []).map((u) => [u.id, u]))
  const perUser: Record<string, { fullName: string | null; email: string; requests: number; inputTokens: number; outputTokens: number; webSearches: number; cost: number }> = {}
  for (const e of rows) {
    const key = e.user_id ?? '__deleted__'
    if (!perUser[key]) {
      const u = e.user_id ? userMap[e.user_id] : undefined
      perUser[key] = { fullName: u?.full_name || null, email: u?.email ?? 'Deleted user', requests: 0, inputTokens: 0, outputTokens: 0, webSearches: 0, cost: 0 }
    }
    perUser[key].requests += 1
    perUser[key].inputTokens += e.tokens_input || 0
    perUser[key].outputTokens += e.tokens_output || 0
    perUser[key].webSearches += e.web_searches || 0
    perUser[key].cost += Number(e.cost_usd || 0)
  }
  const perUserList = Object.values(perUser).sort((a, b) => b.cost - a.cost)
  const maxUserCost = perUserList[0]?.cost || 1

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">

        {/* Page header + range tabs */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Analytics</h1>
            <p className="text-sm text-gray-500 mt-1.5">{label} · all workflows (interview + transcription)</p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={`/admin/analytics?range=${r.key}`}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  rangeKey === r.key
                    ? 'bg-black text-white'
                    : 'bg-white border border-[#e5e3df] text-gray-600 hover:border-gray-400'
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
          <StatCard label="Total Requests" value={totals.requests.toLocaleString()} icon={Activity} sub={totals.errors > 0 ? `${totals.errors} failed` : undefined} />
          <StatCard label="Total Cost" value={`$${totals.cost.toFixed(4)}`} sub={`$${inputCost.toFixed(4)} in + $${outputCost.toFixed(4)} out + $${webSearchCost.toFixed(4)} search`} icon={DollarSign} />
          <StatCard label="Input Tokens" value={formatTokens(totals.inputTokens)} sub="sent to the AI" icon={ArrowUpRight} />
          <StatCard label="Output Tokens" value={formatTokens(totals.outputTokens)} sub="received from the AI" icon={ArrowDownLeft} />
          <StatCard label="Web Searches" value={totals.webSearches.toLocaleString()} sub={`$${WEB_SEARCH_PRICE_PER_REQUEST.toFixed(2)} each`} icon={Search} />
        </div>

        {rows.length === 0 ? (
          <div className="bg-white border border-[#e5e3df] p-10 text-center">
            <Activity size={24} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No activity recorded for this period.</p>
          </div>
        ) : (
          <>
            {/* Cost trend + workflow breakdown */}
            <div className="grid gap-4 lg:grid-cols-5 mb-10">
              {/* Trend — single-series magnitude over time, monochrome bars */}
              <div className="lg:col-span-3 bg-white border border-[#e5e3df] p-5">
                <div className="flex items-center gap-2 mb-5">
                  <TrendingUp size={14} className="text-gray-400" />
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Cost over time</h2>
                </div>
                <div className="flex items-end gap-[3px] h-32">
                  {trend.map((t) => (
                    <div
                      key={t.key}
                      title={`${t.label}: $${t.cost.toFixed(4)} · ${t.requests} request${t.requests === 1 ? '' : 's'}`}
                      className="group flex-1 flex flex-col justify-end h-full min-w-0"
                    >
                      <div
                        className="w-full rounded-t bg-gray-900 group-hover:bg-black transition-colors"
                        style={{ height: `${Math.max((t.cost / maxTrendCost) * 100, t.cost > 0 ? 3 : 0)}%` }}
                      />
                    </div>
                  ))}
                </div>
                {/* Sparse x-axis labels — first, middle, last */}
                <div className="mt-2 flex justify-between text-[10px] text-gray-400">
                  <span>{trend[0]?.label}</span>
                  {trend.length > 2 && <span>{trend[Math.floor(trend.length / 2)]?.label}</span>}
                  <span>{trend[trend.length - 1]?.label}</span>
                </div>
              </div>

              {/* By workflow — magnitude by named category, monochrome + direct labels */}
              <div className="lg:col-span-2 bg-white border border-[#e5e3df] p-5">
                <div className="flex items-center gap-2 mb-5">
                  <Layers size={14} className="text-gray-400" />
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Cost by workflow</h2>
                </div>
                <div className="space-y-4">
                  {byWorkflow.map((w) => (
                    <div key={w.workflow}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-gray-700">{w.label}</span>
                        <span className="font-medium text-gray-900 tabular-nums">${w.cost.toFixed(4)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gray-900 rounded-full" style={{ width: `${(w.cost / maxWorkflowCost) * 100}%` }} />
                      </div>
                      <p className="mt-1 text-[10px] text-gray-400">{w.requests} request{w.requests === 1 ? '' : 's'}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Per-user breakdown */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <Users size={14} className="text-gray-400" />
                <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Breakdown by User</h2>
              </div>
              {perUserList.length > 0 && (
                <span className="text-xs text-gray-400">{perUserList.length} user{perUserList.length !== 1 ? 's' : ''}</span>
              )}
            </div>

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
                            <div className="h-full bg-black rounded-full" style={{ width: `${(u.cost / maxUserCost) * 100}%` }} />
                          </div>
                          <span className="font-medium text-gray-900">${u.cost.toFixed(4)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
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
          </>
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
