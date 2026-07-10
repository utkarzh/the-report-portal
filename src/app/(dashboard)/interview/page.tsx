import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, UserRound, ArrowRight, MessagesSquare, Tag, FileText, CalendarDays, ShieldCheck } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import DeleteInterviewButton from '@/components/research/DeleteInterviewButton'
import ListPagination from '@/components/ui/ListPagination'

const PAGE_SIZE = 12

export default async function InterviewToolPage({ searchParams }: { searchParams: { page?: string } }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('research_sessions')
    .select('id, user_id, full_name, category_name, title_position, company_org, created_at, tokens_total, cost_usd', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (profile.role === 'user') {
    query = query.eq('user_id', profile.id)
  }

  const { data: sessions, count } = await query
  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

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
          className="group inline-flex items-center gap-2.5 rounded-xl bg-black py-2.5 pl-3 pr-4 text-sm font-medium tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15 transition-colors group-hover:bg-white/25">
            <MessagesSquare size={14} />
          </span>
          <span>New Interview</span>
          <Plus size={15} className="opacity-60 transition-opacity group-hover:opacity-100" />
        </Link>
      </div>

      {profile.role === 'admin' && (
        <div className="mb-6 rounded-xl border border-[#db3030]/25 bg-[#fdf6f5] p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 rounded-lg bg-[#db3030]/10 p-2 text-[#db3030]">
                <ShieldCheck size={18} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#db3030]">Admin tools</p>
                <p className="text-sm text-gray-600 mt-0.5">Manage interview categories and prompts from here.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/categories" className="group inline-flex items-center gap-2 rounded-lg border border-[#db3030]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#db3030]/50 hover:text-[#db3030] hover:shadow">
                <Tag size={14} className="text-[#db3030]" />
                <span>Categories</span>
              </Link>
              <Link href="/admin/prompts" className="group inline-flex items-center gap-2 rounded-lg border border-[#db3030]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#db3030]/50 hover:text-[#db3030] hover:shadow">
                <FileText size={14} className="text-[#db3030]" />
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
        <>
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
                <div className="flex items-start gap-3 pr-8">
                  <div className="rounded-lg bg-black p-2 text-white flex-shrink-0">
                    <MessagesSquare size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{s.full_name}</p>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {s.category_name}
                      {s.title_position ? ` · ${s.title_position}` : ''}
                      {s.company_org ? ` · ${s.company_org}` : ''}
                    </p>
                  </div>
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

        {totalPages > 1 && (
          <ListPagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={PAGE_SIZE}
            basePath="/interview"
            label="interviews"
          />
        )}
        </>
      )}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
