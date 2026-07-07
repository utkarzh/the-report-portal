import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { describeUserAgent } from '@/lib/audit'
import Badge from '@/components/ui/Badge'
import AuditLogsPagination from '@/components/admin/AuditLogsPagination'
import { MapPin, Globe, Monitor, ScrollText } from 'lucide-react'
import type { LoginAuditLog } from '@/types'

const PAGE_SIZE = 20

interface SearchParams {
  page?: string
}

export default async function AuditLogsPage({ searchParams }: { searchParams: SearchParams }) {
  requireAdminHeader()

  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data: logs, count } = await supabaseAdmin
    .from('login_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-base font-semibold text-gray-900">Audit Logs</h1>
        <p className="text-sm text-gray-500 mt-1.5">
          Every successful sign-in — who, when, and on which device. Location is
          approximate (derived from IP address).
        </p>
      </div>

      <div className="bg-white border border-[#e5e3df] min-h-[280px] overflow-x-auto">
        <table className="w-full text-xs min-w-[720px]">
          <thead>
            <tr className="border-b border-[#e5e3df] bg-[#f9f8f6]">
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">User</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">When</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Approx. Location</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">IP Address</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Device</th>
              <th className="text-left px-4 py-3 font-semibold uppercase tracking-widest text-gray-400">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e5e3df]">
            {(logs || []).length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-xs text-gray-400">
                  <ScrollText size={24} className="text-gray-200 mx-auto mb-3" />
                  No sign-ins recorded yet.
                </td>
              </tr>
            ) : (
              (logs as LoginAuditLog[]).map((log) => (
                <tr key={log.id} className="hover:bg-[#f9f8f6] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[11px] font-semibold text-gray-500 flex-shrink-0">
                        {(log.full_name || log.email || '?')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate flex items-center gap-1.5">
                          {log.full_name || log.email}
                          {!log.user_id && (
                            <span className="text-[10px] text-gray-400 italic font-normal">(deleted)</span>
                          )}
                        </p>
                        {log.full_name && <p className="text-gray-400 mt-0.5 truncate">{log.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {log.location ? (
                      <span className="flex items-center gap-1.5">
                        <MapPin size={12} className="text-gray-400 flex-shrink-0" />
                        {log.location}
                      </span>
                    ) : (
                      <span className="text-gray-400">Unknown</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-[11px]">
                    {log.ip_address || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="flex items-center gap-1.5" title={log.user_agent || undefined}>
                      <Monitor size={12} className="text-gray-400 flex-shrink-0" />
                      {describeUserAgent(log.user_agent)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {log.login_method ? (
                      <Badge variant={log.login_method === 'password' ? 'admin' : 'user'}>
                        {log.login_method === 'password' ? 'Password' : 'Code'}
                      </Badge>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <AuditLogsPagination page={page} totalPages={totalPages} totalCount={totalCount} />
      )}
    </div>
  )
}
