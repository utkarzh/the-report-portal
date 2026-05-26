import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'

export default async function AnalyticsPage() {
  requireAdminHeader()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

  const [{ data: sessions }, { data: users }] = await Promise.all([
    supabaseAdmin
      .from('research_sessions')
      .select('user_id, tokens_input, tokens_output, tokens_total, cost_usd')
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd),
    supabaseAdmin
      .from('profiles')
      .select('id, full_name, email'),
  ])

  // Aggregate
  const totals = (sessions || []).reduce(
    (acc, s) => ({
      requests: acc.requests + 1,
      inputTokens: acc.inputTokens + (s.tokens_input || 0),
      outputTokens: acc.outputTokens + (s.tokens_output || 0),
      cost: acc.cost + Number(s.cost_usd || 0),
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
  )

  const userMap = Object.fromEntries((users || []).map(u => [u.id, u]))

  const perUser: Record<string, {
    fullName: string | null;
    email: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
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
        cost: 0,
      }
    }
    perUser[key].requests += 1
    perUser[key].inputTokens += s.tokens_input || 0
    perUser[key].outputTokens += s.tokens_output || 0
    perUser[key].cost += Number(s.cost_usd || 0)
  }

  const perUserList = Object.values(perUser).sort((a, b) => b.cost - a.cost)

  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div className="p-8">
      <h1 className="text-base font-semibold text-gray-900 mb-1">Analytics</h1>
      <p className="text-xs text-gray-500 mb-6">{monthLabel}</p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 max-w-3xl">
        <StatCard label="Total Requests" value={totals.requests.toLocaleString()} />
        <StatCard label="Total Cost" value={`$${totals.cost.toFixed(4)}`} />
        <StatCard label="Input Tokens" value={formatTokens(totals.inputTokens)} />
        <StatCard label="Output Tokens" value={formatTokens(totals.outputTokens)} />
      </div>

      {/* Per-user breakdown */}
      <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
        Breakdown by User
      </h2>

      {perUserList.length === 0 ? (
        <p className="text-sm text-gray-400">No activity this month.</p>
      ) : (
        <div className="bg-white border border-[#e5e3df] overflow-hidden max-w-3xl">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#e5e3df] bg-[#f9f8f6]">
                <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">User</th>
                <th className="text-right px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Requests</th>
                <th className="text-right px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Tokens</th>
                <th className="text-right px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5e3df]">
              {perUserList.map((u, i) => (
                <tr key={i} className="hover:bg-[#f9f8f6]">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{u.fullName || u.email}</p>
                    {u.fullName && <p className="text-gray-400 mt-0.5">{u.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{u.requests}</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {formatTokens(u.inputTokens + u.outputTokens)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    ${u.cost.toFixed(4)}
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[#e5e3df] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
