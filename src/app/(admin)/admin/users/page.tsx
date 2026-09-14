import { requireAdminHeader, getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Badge from '@/components/ui/Badge'
import UserActionsMenu from '@/components/admin/UserActionsMenu'
import UsersFilter from '@/components/admin/UsersFilter'
import { ACCESS_LABELS, parseAccessParam, type AccessKey } from '@/lib/access-filters'
import UsersPagination from '@/components/admin/UsersPagination'
import InviteUserButton from '@/components/admin/InviteUserButton'
import { Users, ShieldCheck, Newspaper, Wallet } from 'lucide-react'
import type { Profile } from '@/types'

const PAGE_SIZE = 10
// Fraction of the monthly token limit at which a user is flagged as "near limit".
const NEAR_LIMIT = 0.8

// Finance ('finance_field') isn't here on purpose — it maps to finance_role,
// not a can_access_* column, and is handled separately in the query below.
const EDITORIAL_ACCESS_COLUMN_MAP: Partial<Record<AccessKey, keyof Profile>> = {
  interview: 'can_access_interview',
  transcriptions: 'can_access_transcriptions',
  business_cases: 'can_access_business_cases',
  editorial_briefs: 'can_access_editorial_briefs',
  meeting_preparation: 'can_access_meeting_preparation',
  interview_letters: 'can_access_interview_letter_generator',
  sales_coach: 'can_access_sales_negotiation_coach',
}

interface SearchParams {
  search?: string
  role?: string
  usage?: string
  access?: string
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

// Editorial module pills a user has, for the Access column. Admins get a
// single "All access" badge instead — the flags below are only meaningful
// for normal users (see access.ts).
const EDITORIAL_MODULES: { key: keyof Profile; label: string }[] = [
  { key: 'can_access_interview', label: 'Interview' },
  { key: 'can_access_transcriptions', label: 'Transcriptions' },
  { key: 'can_access_business_cases', label: 'Business Cases' },
  { key: 'can_access_editorial_briefs', label: 'Editorial Briefs' },
  { key: 'can_access_meeting_preparation', label: 'Meeting Prep' },
  { key: 'can_access_interview_letter_generator', label: 'Interview Letters' },
  { key: 'can_access_sales_negotiation_coach', label: 'Sales Coach' },
]

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  requireAdminHeader()
  const adminProfile = getProfileFromHeaders()

  const search = typeof searchParams.search === 'string' ? searchParams.search.trim() : ''
  const roleFilter = searchParams.role === 'admin' || searchParams.role === 'user' ? searchParams.role : ''
  const usageFilter = searchParams.usage === 'near' ? 'near' : ''
  const accessFilters = parseAccessParam(searchParams.access)
  const accessParam = searchParams.access && accessFilters.length ? searchParams.access : ''
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
    if (accessFilters.length) {
      // Multi-select access filter: match a user who satisfies ANY selected
      // module. Editorial keys OR in role.eq.admin (admins hold every
      // editorial module implicitly, see access.ts); finance_field does not
      // — admins are finance_admin, not "field".
      const orParts: string[] = []
      const editorialSelected = accessFilters.filter((k) => k in EDITORIAL_ACCESS_COLUMN_MAP)
      if (editorialSelected.length) {
        orParts.push('role.eq.admin')
        editorialSelected.forEach((k) => orParts.push(`${EDITORIAL_ACCESS_COLUMN_MAP[k]}.eq.true`))
      }
      if (accessFilters.includes('finance_field')) {
        orParts.push('finance_role.eq.field')
      }
      q = q.or(orParts.join(','))
    }
    return q
  }

  // The filtered/paginated table and the org-wide stats row are independent
  // of each other — run them together instead of one-after-the-other so this
  // page needs only one round trip to the database, not two.
  const [{ data: tableData, count }, { data: statsRows }] = await Promise.all([
    usageFilter === 'near' ? baseQuery() : baseQuery().range(from, to),
    // One lightweight query powers every overview number: the near-limit tab
    // badge and the department stat cards — unaffected by the current filters,
    // so they always read as the whole-org picture.
    supabaseAdmin
      .from('profiles')
      .select(
        'role, tokens_used, token_limit, can_access_interview, can_access_transcriptions, can_access_business_cases, can_access_editorial_briefs, can_access_meeting_preparation, can_access_interview_letter_generator, can_access_sales_negotiation_coach, finance_role',
      ),
  ])

  let users: Profile[]
  let totalCount: number
  let totalPages: number

  if (usageFilter === 'near') {
    // The near-limit condition is a ratio (tokens_used / token_limit) that
    // PostgREST can't filter on directly, so fetch the matching set and filter
    // in memory. The team is small, so this stays cheap; pagination is skipped
    // for this focused view.
    users = (tableData || []).filter((u: Profile) => usageState(u) !== 'none')
    totalCount = users.length
    totalPages = 1
  } else {
    users = tableData || []
    totalCount = count || 0
    totalPages = Math.ceil(totalCount / PAGE_SIZE)
  }

  const allProfiles = statsRows || []
  const totalUsers = allProfiles.length
  const adminCount = allProfiles.filter((u) => u.role === 'admin').length
  const editorialCount = allProfiles.filter(
    (u) =>
      u.role === 'admin' ||
      u.can_access_interview ||
      u.can_access_transcriptions ||
      u.can_access_business_cases ||
      u.can_access_editorial_briefs ||
      u.can_access_meeting_preparation ||
      u.can_access_interview_letter_generator ||
      u.can_access_sales_negotiation_coach,
  ).length
  const financeCount = allProfiles.filter((u) => u.role === 'admin' || u.finance_role !== null).length
  const nearCount = allProfiles.filter(
    (u) => u.role === 'user' && u.token_limit != null && u.token_limit > 0 && u.tokens_used / u.token_limit >= NEAR_LIMIT,
  ).length

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Users</h1>
          <p className="text-xs text-gray-400 mt-0.5">Editorial and Finance access, in one directory.</p>
        </div>
        <InviteUserButton />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Users" value={totalUsers} icon={Users} accent="neutral" />
        <StatCard label="Admins" value={adminCount} icon={ShieldCheck} sub="Full access, both depts." accent="slate" />
        <StatCard label="Editorial Access" value={editorialCount} icon={Newspaper} sub="Any editorial module" accent="sky" />
        <StatCard label="Finance Access" value={financeCount} icon={Wallet} sub="Cash Box" accent="emerald" />
      </div>

      <UsersFilter search={search} role={roleFilter} usage={usageFilter} access={accessParam} nearCount={nearCount} />

      <div className="bg-white border border-[#e5e3df] min-h-[280px] overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#e5e3df] bg-[#f9f8f6]">
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Name</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Role</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Access</th>
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
                    : search || roleFilter || accessFilters.length
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {usage !== 'none' && (
                        <span
                          title={usage === 'over' ? 'Token limit reached' : 'Approaching token limit'}
                          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${usage === 'over' ? 'bg-red-500' : 'bg-amber-500'}`}
                        />
                      )}
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">
                          {user.full_name || <span className="text-gray-400 italic">—</span>}
                        </span>
                        <span className="text-gray-400 text-[11px]">{user.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={user.role === 'admin' ? 'admin' : 'user'}>
                      {user.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <AccessPills user={user} />
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
        <UsersPagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          search={search}
          role={roleFilter}
          access={accessParam}
        />
      )}
    </div>
  )
}

// Compact per-module pills for the Access column. Admins hold every module
// implicitly (see access.ts) rather than via the can_access_* flags, so they
// get one "All access" badge instead of the raw (usually all-false) flags.
function AccessPills({ user }: { user: Profile }) {
  if (user.role === 'admin') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wider bg-black text-white">
        All access
      </span>
    )
  }

  const editorial = EDITORIAL_MODULES.filter((m) => Boolean(user[m.key]))
  const hasFinance = user.finance_role === 'field'

  if (editorial.length === 0 && !hasFinance) {
    return <span className="text-gray-300">—</span>
  }

  return (
    <div className="flex flex-wrap gap-1 max-w-[220px]">
      {editorial.map((m) => (
        <span
          key={m.key}
          className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200"
        >
          {m.label}
        </span>
      ))}
      {hasFinance && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          {ACCESS_LABELS.finance_field}
        </span>
      )}
    </div>
  )
}

type StatAccent = 'neutral' | 'slate' | 'sky' | 'emerald'

// One restrained accent per card — a thin top rule plus a tinted icon chip —
// so the row scans at a glance instead of reading as four identical tiles.
// Colors stay inside the palette already used elsewhere on this page
// (emerald = finance, matching AccessPills below) rather than introducing a
// new one.
const STAT_ACCENT_STYLES: Record<StatAccent, { rule: string; chipBg: string; chipText: string }> = {
  neutral: { rule: 'bg-gray-900', chipBg: 'bg-gray-900', chipText: 'text-white' },
  slate: { rule: 'bg-gray-300', chipBg: 'bg-gray-100', chipText: 'text-gray-600' },
  sky: { rule: 'bg-sky-400', chipBg: 'bg-sky-50', chipText: 'text-sky-600' },
  emerald: { rule: 'bg-emerald-400', chipBg: 'bg-emerald-50', chipText: 'text-emerald-600' },
}

interface StatCardProps {
  label: string
  value: number
  icon: React.ElementType
  sub?: string
  accent?: StatAccent
}

function StatCard({ label, value, icon: Icon, sub, accent = 'neutral' }: StatCardProps) {
  const a = STAT_ACCENT_STYLES[accent]
  return (
    <div className="relative overflow-hidden bg-white border border-[#e5e3df] p-5 transition-colors hover:border-gray-300">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${a.rule}`} />
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 leading-tight pt-1.5">
          {label}
        </p>
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm ${a.chipBg}`}>
          <Icon size={15} strokeWidth={1.75} className={a.chipText} />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900 tabular-nums leading-none tracking-tight">
        {value.toLocaleString()}
      </p>
      {sub && <p className="text-[10px] text-gray-400 mt-2">{sub}</p>}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
