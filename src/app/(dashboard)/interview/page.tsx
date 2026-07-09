import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, UserRound, ArrowRight, MessagesSquare, Tag, FileText, CalendarDays } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import DeleteInterviewButton from '@/components/research/DeleteInterviewButton'

export default async function InterviewToolPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('research_sessions')
    .select('id, user_id, full_name, category_name, title_position, company_org, created_at, tokens_total, cost_usd')
    .order('created_at', { ascending: false })
    .limit(50)

  if (profile.role === 'user') {
    query = query.eq('user_id', profile.id)
  }

  const { data: sessions } = await query

  let creatorNameMap = new Map<string, string>()
  if (profile.role === 'admin' && sessions?.length) {
    const userIds = sessions
      .map((session) => session.user_id)
      .filter((id): id is string => Boolean(id))

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)

      profiles?.forEach((profileRow) => {
        creatorNameMap.set(profileRow.id, profileRow.full_name || 'Unknown user')
      })
    }
  }

  const sessionsWithCreators = (sessions || []).map((session) => ({
    ...session,
    creatorName:
      profile.role === 'admin'
        ? session.user_id
          ? creatorNameMap.get(session.user_id) || 'Deleted user'
          : 'Deleted user'
        : null,
  }))

  return (
    <div className="p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700">
            <MessagesSquare size={18} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Interview Tool</h1>
            <p className="text-sm text-gray-500 mt-1">
              Review past interviews and launch a new one from here.
            </p>
          </div>
        </div>

        <Link
          href="/research"
          className="inline-flex items-center justify-center gap-2 bg-black text-white px-4 py-2.5 text-sm font-medium tracking-wide uppercase hover:bg-gray-900 transition-colors"
        >
          <Plus size={16} />
          <span>New Interview</span>
        </Link>
      </div>

      {profile.role === 'admin' && (
        <div className="mb-6 rounded-xl border border-[#db3030]/30 bg-[#fdf6f5] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#db3030]">Admin tools</p>
              <p className="text-sm text-gray-600 mt-1">Manage interview categories and prompts from here.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/categories" className="inline-flex items-center gap-2 rounded-md border border-[#db3030]/30 bg-white px-3 py-2 text-sm text-gray-700 hover:border-[#db3030]/60 hover:text-[#db3030] transition-colors">
                <Tag size={14} />
                <span>Categories</span>
              </Link>
              <Link href="/admin/prompts" className="inline-flex items-center gap-2 rounded-md border border-[#db3030]/30 bg-white px-3 py-2 text-sm text-gray-700 hover:border-[#db3030]/60 hover:text-[#db3030] transition-colors">
                <FileText size={14} />
                <span>Prompts</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {!sessionsWithCreators || sessionsWithCreators.length === 0 ? (
        <div className="rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500 shadow-sm flex items-start gap-3">
          <div className="rounded-lg bg-[#f7f6f3] p-2 text-gray-600">
            <MessagesSquare size={16} />
          </div>
          <span>No interviews yet. Start one to build your first research session.</span>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sessionsWithCreators.map((s) => (
            <div key={s.id} className="group relative">
              {/* Delete (admin-only) floats over the card corner, revealed on
                  hover. Sits outside the <Link> so its click never navigates. */}
              {profile.role === 'admin' && (
                <div className="absolute right-3 top-3 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <DeleteInterviewButton
                    sessionId={s.id}
                    interviewTitle={s.full_name}
                    variant="icon"
                  />
                </div>
              )}

              <Link
                href={`/research/${s.id}`}
                className="block rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-400 hover:shadow-sm"
              >
                <div className="min-w-0 pr-8">
                  <p className="text-sm font-semibold text-gray-900 truncate">{s.full_name}</p>
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    {s.category_name}
                    {s.title_position ? ` · ${s.title_position}` : ''}
                    {s.company_org ? ` · ${s.company_org}` : ''}
                  </p>
                </div>

                <div className="mt-4 space-y-2 text-[11px] text-gray-500">
                  <div className="flex items-center gap-2 text-gray-400">
                    <CalendarDays size={12} />
                    <span>
                      {new Date(s.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>

                  {profile.role === 'admin' && s.creatorName ? (
                    <div className="flex items-center gap-2 rounded-md bg-stone-50 px-2.5 py-2 text-stone-700">
                      <UserRound size={12} className="text-stone-500" />
                      <span>Created by {s.creatorName}</span>
                    </div>
                  ) : null}

                  {s.tokens_total > 0 ? (
                    <div className="flex items-center gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-amber-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      <span>{formatTokens(s.tokens_total)} tokens</span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex items-center justify-between text-sm font-medium text-gray-700">
                  <span>View interview</span>
                  <ArrowRight size={16} className="text-gray-400 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            </div>
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
