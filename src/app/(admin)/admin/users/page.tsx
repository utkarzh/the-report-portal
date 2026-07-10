import { requireAdminHeader, getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Badge from '@/components/ui/Badge'
import UserActionsMenu from '@/components/admin/UserActionsMenu'
import UsersFilter from '@/components/admin/UsersFilter'
import UsersPagination from '@/components/admin/UsersPagination'
import InviteUserButton from '@/components/admin/InviteUserButton'
import type { Profile } from '@/types'

const PAGE_SIZE = 10
// Fraction of the monthly token limit at which a user is flagged as "near limit".
const NEAR_LIMIT = 0.8

interface SearchParams {
  search?: string
  role?: string
  usage?: string
  page?: string
}

// Where a user sits against their monthly token allowance. Drives both the
// row highlight and the "Near limit" tab filter. Admins have no limit, so they
// are never flagged — this only ever applies to normal users.
function usageState(user: Profile): 'none' | 'near' | 'over' {
  if (user.role === 'admin') return 'none'
  if (user.token_limit == null || user.token_limit <= 0) return 'none'
  const ratio = user.tokens_used / user.token_limit
  if (ratio >= 1) return 'over'
  if (ratio >= NEAR_LIMIT) return 'near'
  return 'none'
}

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  requireAdminHeader()
  const adminProfile = getProfileFromHeaders()

  const search = typeof searchParams.search === 'string' ? searchParams.search.trim() : ''
  const roleFilter = searchParams.role === 'admin' || searchParams.role === 'user' ? searchParams.role : ''
  const usageFilter = searchParams.usage === 'near' ? 'near' : ''
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const baseQuery = () => {
    let q = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
    if (search) q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
    if (roleFilter) q = q.eq('role', roleFilter)
    return q
  }

  let users: Profile[]
  let totalCount: number
  let totalPages: number

  if (usageFilter === 'near') {
    // The near-limit condition is a ratio (tokens_used / token_limit) that
    // PostgREST can't filter on directly, so fetch the matching set and filter
    // in memory. The team is small, so this stays cheap; pagination is skipped
    // for this focused view.
    const { data } = await baseQuery()
    users = (data || []).filter((u: Profile) => usageState(u) !== 'none')
    totalCount = users.length
    totalPages = 1
  } else {
    const { data, count } = await baseQuery().range(from, to)
    users = data || []
    totalCount = count || 0
    totalPages = Math.ceil(totalCount / PAGE_SIZE)
  }

  // Count of near/over-limit NORMAL users — powers the tab badge. Admins have
  // no limit and are excluded.
  const { data: usageRows } = await supabaseAdmin
    .from('profiles')
    .select('tokens_used, token_limit')
    .eq('role', 'user')
  const nearCount = (usageRows || []).filter(
    (u) => u.token_limit != null && u.token_limit > 0 && u.tokens_used / u.token_limit >= NEAR_LIMIT,
  ).length

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-base font-semibold text-gray-900">Users</h1>
        <InviteUserButton />
      </div>

      <UsersFilter search={search} role={roleFilter} usage={usageFilter} nearCount={nearCount} />

      <div className="bg-white border border-[#e5e3df] min-h-[280px]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#e5e3df] bg-[#f9f8f6]">
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Name</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Email</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Role</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Tokens</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Status</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e5e3df]">
            {(users || []).length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-xs text-gray-400">
                  {usageFilter === 'near'
                    ? 'No users are close to their token limit.'
                    : search || roleFilter
                    ? 'No users match your filters.'
                    : 'No users yet.'}
                </td>
              </tr>
            ) : (
              (users || []).map((user: Profile) => {
                const usage = usageState(user)
                const rowClass =
                  usage === 'over'
                    ? 'bg-red-50/70 hover:bg-red-50'
                    : usage === 'near'
                    ? 'bg-amber-50/70 hover:bg-amber-50'
                    : 'hover:bg-[#f9f8f6]'
                const pct = user.token_limit ? Math.min((user.tokens_used / user.token_limit) * 100, 100) : 0
                const barColor = usage === 'over' ? 'bg-red-500' : usage === 'near' ? 'bg-amber-500' : 'bg-black'
                return (
                <tr key={user.id} className={`${rowClass} transition-colors`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      {usage !== 'none' && (
                        <span
                          title={usage === 'over' ? 'Token limit reached' : 'Approaching token limit'}
                          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${usage === 'over' ? 'bg-red-500' : 'bg-amber-500'}`}
                        />
                      )}
                      {user.full_name || <span className="text-gray-400 italic">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={user.role === 'admin' ? 'admin' : 'user'}>
                      {user.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {user.token_limit == null ? (
                      // No cap (admins) — still surface how much they've used.
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-600 tabular-nums">{formatTokens(user.tokens_used)}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-400">No limit</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-gray-500">
                            {formatTokens(user.tokens_used)}/{formatTokens(user.token_limit)}
                          </span>
                        </div>
                        {usage !== 'none' && (
                          <span
                            className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              usage === 'over'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {usage === 'over' ? 'Limit reached' : `Near limit · ${Math.round(pct)}%`}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={user.status === 'active' ? 'active' : 'inactive'}>
                      {user.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(user.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <UserActionsMenu user={user} currentAdminId={adminProfile?.id ?? ''} />
                  </td>
                </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <UsersPagination page={page} totalPages={totalPages} totalCount={totalCount} search={search} role={roleFilter} />
      )}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
