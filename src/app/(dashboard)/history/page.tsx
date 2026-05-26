import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function HistoryPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('research_sessions')
    .select('id, full_name, category_name, title_position, company_org, created_at, tokens_total, cost_usd')
    .order('created_at', { ascending: false })
    .limit(50)

  // Admins see all; users see only their own
  if (profile.role === 'user') {
    query = query.eq('user_id', profile.id)
  }

  const { data: sessions } = await query

  return (
    <div className="p-8">
      <h1 className="text-base font-semibold text-gray-900 mb-6">Research History</h1>

      {!sessions || sessions.length === 0 ? (
        <div className="text-sm text-gray-400 py-8">
          No research sessions yet.{' '}
          <Link href="/research" className="underline hover:text-gray-600">
            Start your first interview
          </Link>
        </div>
      ) : (
        <div className="space-y-2 max-w-3xl">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/research/${s.id}`}
              className="flex items-center justify-between p-4 bg-white border border-[#e5e3df] hover:border-gray-400 transition-colors group"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{s.full_name}</p>
                <p className="text-xs text-gray-500 truncate mt-0.5">
                  {s.category_name}
                  {s.title_position ? ` · ${s.title_position}` : ''}
                  {s.company_org ? ` · ${s.company_org}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-4 ml-4 flex-shrink-0 text-right">
                <div className="text-xs text-gray-400">
                  {s.tokens_total > 0 && <span>{formatTokens(s.tokens_total)} tokens</span>}
                </div>
                <div className="text-xs text-gray-400">
                  {new Date(s.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
