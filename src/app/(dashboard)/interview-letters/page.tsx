export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Mail, ShieldCheck } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import DeleteInterviewLetterButton from '@/components/interview-letters/DeleteInterviewLetterButton'
import ListPagination from '@/components/ui/ListPagination'
import EntityCard from '@/components/ui/EntityCard'
import SearchInput from '@/components/ui/SearchInput'
import StatusPill from '@/components/ui/StatusPill'
import { orIlikeFilter } from '@/lib/search'

const PAGE_SIZE = 12

const STAGE_LABELS: Record<string, string> = {
  input: 'Starting…',
  researching: 'Researching',
  hook_review: 'Hook review',
  letter_generating: 'Generating letter',
  letter_review: 'Letter review',
  letter_approved: 'Letter approved',
  email_generating: 'Generating email',
  email_review: 'Email review',
  complete: 'Complete',
  failed: 'Failed',
}

export default async function InterviewLettersPage({ searchParams }: { searchParams: { page?: string; search?: string } }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const search = typeof searchParams.search === 'string' ? searchParams.search.trim() : ''
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('interview_letter_projects')
    .select('id, user_id, company, project_country, media_partner, stage, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (profile.role === 'user') {
    query = query.eq('user_id', profile.id)
  }
  if (search) {
    query = query.or(orIlikeFilter(['company', 'project_country', 'media_partner'], search))
  }

  const { data: rows, count } = await query
  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const creatorNameMap = new Map<string, string>()
  if (profile.role === 'admin' && rows?.length) {
    const userIds = rows.map((r) => r.user_id).filter((id): id is string => Boolean(id))
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds)
      profiles?.forEach((p) => creatorNameMap.set(p.id, p.full_name || 'Unknown user'))
    }
  }

  const items = (rows || []).map((r) => ({
    ...r,
    creatorName:
      profile.role === 'admin'
        ? r.user_id ? creatorNameMap.get(r.user_id) || 'Deleted user' : 'Deleted user'
        : null,
  }))

  return (
    <div className="p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700">
            <Mail size={18} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Interview Letters</h1>
            <p className="text-sm text-gray-500 mt-1">Review past letter &amp; email projects and start a new one from here.</p>
          </div>
        </div>

        <Link
          href="/interview-letters/new"
          className="group inline-flex items-center gap-2.5 rounded-xl bg-black py-2.5 pl-3 pr-4 text-sm font-medium tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15 transition-colors group-hover:bg-white/25">
            <Mail size={14} />
          </span>
          <span>New Project</span>
          <Plus size={15} className="opacity-60 transition-opacity group-hover:opacity-100" />
        </Link>
      </div>

      {profile.role === 'admin' && (
        <div className="mb-6 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 rounded-lg bg-[#c8973f]/10 p-2 text-[#a07530]">
                <ShieldCheck size={18} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">Admin tools</p>
                <p className="text-sm text-gray-600 mt-0.5">Manage the TRC and GFDI letter templates.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/interview-letters" className="group inline-flex items-center gap-2 rounded-lg border border-[#c8973f]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c8973f]/50 hover:text-[#a07530] hover:shadow">
                <ShieldCheck size={14} className="text-[#a07530]" />
                <span>Admin area</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <SearchInput basePath="/interview-letters" initialValue={search} placeholder="Search by company, country, media partner..." />
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500 shadow-sm flex items-start gap-3">
          <div className="rounded-lg bg-[#f7f6f3] p-2 text-gray-600">
            <Mail size={16} />
          </div>
          {search ? (
            <span>
              No projects match &ldquo;<span className="font-medium text-gray-700">{search}</span>&rdquo;.{' '}
              <Link href="/interview-letters" className="text-gray-700 underline hover:text-black">Clear search</Link>
            </span>
          ) : (
            <span>No interview letter projects yet. Create one to get started.</span>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((p, i) => (
              <EntityCard
                key={p.id}
                index={i}
                href={`/interview-letters/${p.id}`}
                icon={<Mail size={16} />}
                title={`${p.company} — ${p.media_partner}`}
                subtitle={p.project_country}
                date={new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                creatorName={p.creatorName}
                badge={
                  <StatusPill
                    label={STAGE_LABELS[p.stage] || p.stage}
                    tone={p.stage === 'complete' ? 'emerald' : p.stage === 'failed' ? 'red' : 'amber'}
                    pulse={p.stage !== 'complete' && p.stage !== 'failed'}
                  />
                }
                footerLabel="View project"
                deleteSlot={profile.role === 'admin' ? <DeleteInterviewLetterButton projectId={p.id} title={`${p.company} — ${p.media_partner}`} variant="icon" /> : undefined}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <ListPagination
              page={page}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={PAGE_SIZE}
              basePath="/interview-letters"
              label="interview letter projects"
              search={search}
            />
          )}
        </>
      )}
    </div>
  )
}
