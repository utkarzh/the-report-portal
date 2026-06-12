import { requireAdminHeader, getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Badge from '@/components/ui/Badge'
import UserActionsMenu from '@/components/admin/UserActionsMenu'
import UsersFilter from '@/components/admin/UsersFilter'
import UsersPagination from '@/components/admin/UsersPagination'
import InviteUserButton from '@/components/admin/InviteUserButton'
import type { Profile } from '@/types'

const PAGE_SIZE = 10

interface SearchParams {
  search?: string
  role?: string
  page?: string
}

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  requireAdminHeader()
  const adminProfile = getProfileFromHeaders()

  const search = typeof searchParams.search === 'string' ? searchParams.search.trim() : ''
  const roleFilter = searchParams.role === 'admin' || searchParams.role === 'user' ? searchParams.role : ''
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  let query = supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
  }
  if (roleFilter) {
    query = query.eq('role', roleFilter)
  }

  const { data: users, count } = await query

  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-base font-semibold text-gray-900">Users</h1>
        <InviteUserButton />
      </div>

      <UsersFilter search={search} role={roleFilter} />

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
                  {search || roleFilter ? 'No users match your filters.' : 'No users yet.'}
                </td>
              </tr>
            ) : (
              (users || []).map((user: Profile) => (
                <tr key={user.id} className="hover:bg-[#f9f8f6] transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {user.full_name || <span className="text-gray-400 italic">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={user.role === 'admin' ? 'admin' : 'user'}>
                      {user.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {user.token_limit == null ? (
                      <span className="text-gray-400">No limit</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-black rounded-full"
                            style={{
                              width: `${Math.min((user.tokens_used / user.token_limit) * 100, 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-gray-500">
                          {formatTokens(user.tokens_used)}/{formatTokens(user.token_limit)}
                        </span>
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
              ))
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
