export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, UserRound, ArrowRight, AudioLines, WandSparkles, CheckCircle2, Loader2, AlertCircle, CalendarDays, Sparkles, ShieldCheck } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { reconcilePendingTranscriptions } from '@/lib/assemblyai/reconcile'
import DeleteTranscriptionButton from '@/components/transcriptions/DeleteTranscriptionButton'
import ListPagination from '@/components/ui/ListPagination'
import type { TranscriptionStatus } from '@/types'

const PAGE_SIZE = 12

export default async function TranscriptionsPage({ searchParams }: { searchParams: { page?: string } }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  // Heal any transcripts that finished on AssemblyAI while no tab was polling,
  // so they don't sit stuck at 'transcribing' in the list below.
  await reconcilePendingTranscriptions(
    profile.role === 'user' ? { userId: profile.id } : {},
  )

  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('transcriptions')
    .select('id, user_id, title, audio_filename, status, created_at, tokens_total, cost_usd', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (profile.role === 'user') {
    query = query.eq('user_id', profile.id)
  }

  const { data: transcriptions, count } = await query
  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // Resolve creator names for the admin view (same approach as the interview tool).
  const creatorNameMap = new Map<string, string>()
  if (profile.role === 'admin' && transcriptions?.length) {
    const userIds = transcriptions
      .map((t) => t.user_id)
      .filter((id): id is string => Boolean(id))
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
      profiles?.forEach((row) => creatorNameMap.set(row.id, row.full_name || 'Unknown user'))
    }
  }

  const rows = (transcriptions || []).map((t) => ({
    ...t,
    creatorName:
      profile.role === 'admin'
        ? t.user_id
          ? creatorNameMap.get(t.user_id) || 'Deleted user'
          : 'Deleted user'
        : null,
  }))

  const isAdmin = profile.role === 'admin'

  return (
    <div className="p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700">
            <AudioLines size={18} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Transcriptions</h1>
            <p className="text-sm text-gray-500 mt-1">
              Review past transcripts and start a new one from here.
            </p>
          </div>
        </div>

        <Link
          href="/transcriptions/new"
          className="group inline-flex items-center gap-2.5 rounded-xl bg-black py-2.5 pl-3 pr-4 text-sm font-medium tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15 transition-colors group-hover:bg-white/25">
            <AudioLines size={14} />
          </span>
          <span>New Transcript</span>
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
                <p className="text-sm text-gray-600 mt-0.5">Manage the prompt used to refine transcripts with AI.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/transcript-prompt" className="group inline-flex items-center gap-2 rounded-lg border border-[#db3030]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#db3030]/50 hover:text-[#db3030] hover:shadow">
                <WandSparkles size={14} className="text-[#db3030]" />
                <span>Refining Prompt</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500 shadow-sm flex items-start gap-3">
          <div className="rounded-lg bg-[#f7f6f3] p-2 text-gray-600">
            <AudioLines size={16} />
          </div>
          <span>No transcripts yet. Start one to build your first transcription.</span>
        </div>
      ) : (
        <>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => (
            <div key={t.id} className="group relative">
              {/* Delete (admin-only) floats over the card corner, revealed on
                  hover. Sits outside the <Link> so its click never navigates. */}
              {profile.role === 'admin' && (
                <div className="absolute right-3 top-3 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <DeleteTranscriptionButton
                    transcriptionId={t.id}
                    transcriptionTitle={t.title}
                    variant="icon"
                  />
                </div>
              )}

              <Link
                href={`/transcriptions/${t.id}`}
                className="block rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-400 hover:shadow-sm"
              >
                <div className="flex items-start gap-3 pr-8">
                  <div className="rounded-lg bg-black p-2 text-white flex-shrink-0">
                    <AudioLines size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{t.title}</p>
                    <p className="text-xs text-gray-500 mt-1 truncate">{t.audio_filename || 'audio'}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-[11px] text-gray-500">
                  <div className="flex items-center justify-between gap-2 text-gray-400">
                    <div className="flex items-center gap-2">
                      <CalendarDays size={12} />
                      <span>
                        {new Date(t.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    {isAdmin && Number(t.cost_usd) > 0 && (
                      <span
                        title="AI (Claude) cost for refine & translation"
                        className="inline-flex items-center gap-1 rounded-full bg-[#f7f6f3] px-2 py-0.5 font-medium text-gray-600 tabular-nums"
                      >
                        <Sparkles size={10} />${Number(t.cost_usd).toFixed(4)}
                      </span>
                    )}
                  </div>

                  {profile.role === 'admin' && t.creatorName ? (
                    <div className="flex items-center gap-2 rounded-md bg-stone-50 px-2.5 py-2 text-stone-700">
                      <UserRound size={12} className="text-stone-500" />
                      <span>Created by {t.creatorName}</span>
                    </div>
                  ) : null}

                  <StatusBadge status={t.status as TranscriptionStatus} />
                </div>

                <div className="mt-5 flex items-center justify-between text-sm font-medium text-gray-700">
                  <span>View transcript</span>
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
            basePath="/transcriptions"
            label="transcripts"
          />
        )}
        </>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: TranscriptionStatus }) {
  const map: Record<TranscriptionStatus, { label: string; className: string; icon: React.ReactNode }> = {
    uploaded: { label: 'Queued', className: 'bg-stone-50 text-stone-600', icon: <Loader2 size={12} /> },
    transcribing: { label: 'Transcribing', className: 'bg-amber-50 text-amber-700', icon: <Loader2 size={12} className="animate-spin" /> },
    transcribed: { label: 'Transcribed', className: 'bg-sky-50 text-sky-700', icon: <CheckCircle2 size={12} /> },
    refining: { label: 'Refining', className: 'bg-amber-50 text-amber-700', icon: <Loader2 size={12} className="animate-spin" /> },
    refined: { label: 'Refined', className: 'bg-emerald-50 text-emerald-700', icon: <CheckCircle2 size={12} /> },
    failed: { label: 'Failed', className: 'bg-red-50 text-red-700', icon: <AlertCircle size={12} /> },
  }
  const s = map[status] ?? map.uploaded
  return (
    <div className={`flex items-center gap-2 rounded-md px-2.5 py-2 ${s.className}`}>
      {s.icon}
      <span>{s.label}</span>
    </div>
  )
}
