export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, UserRound, ArrowRight, AudioLines, WandSparkles, CheckCircle2, Loader2, AlertCircle, CalendarDays } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { reconcilePendingTranscriptions } from '@/lib/assemblyai/reconcile'
import DeleteTranscriptionButton from '@/components/transcriptions/DeleteTranscriptionButton'
import type { TranscriptionStatus } from '@/types'

export default async function TranscriptionsPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  // Heal any transcripts that finished on AssemblyAI while no tab was polling,
  // so they don't sit stuck at 'transcribing' in the list below.
  await reconcilePendingTranscriptions(
    profile.role === 'user' ? { userId: profile.id } : {},
  )

  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('transcriptions')
    .select('id, user_id, title, audio_filename, status, created_at, tokens_total')
    .order('created_at', { ascending: false })
    .limit(50)

  if (profile.role === 'user') {
    query = query.eq('user_id', profile.id)
  }

  const { data: transcriptions } = await query

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
          className="inline-flex items-center justify-center gap-2 bg-black text-white px-4 py-2.5 text-sm font-medium tracking-wide uppercase hover:bg-gray-900 transition-colors"
        >
          <Plus size={16} />
          <span>New Transcript</span>
        </Link>
      </div>

      {profile.role === 'admin' && (
        <div className="mb-6 rounded-xl border border-[#db3030]/30 bg-[#fdf6f5] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#db3030]">Admin tools</p>
              <p className="text-sm text-gray-600 mt-1">Manage the prompt used to refine transcripts with AI.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/transcript-prompt" className="inline-flex items-center gap-2 rounded-md border border-[#db3030]/30 bg-white px-3 py-2 text-sm text-gray-700 hover:border-[#db3030]/60 hover:text-[#db3030] transition-colors">
                <WandSparkles size={14} />
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
                <div className="min-w-0 pr-8">
                  <p className="text-sm font-semibold text-gray-900 truncate">{t.title}</p>
                  <p className="text-xs text-gray-500 mt-1 truncate">{t.audio_filename || 'audio'}</p>
                </div>

                <div className="mt-4 space-y-2 text-[11px] text-gray-500">
                  <div className="flex items-center gap-2 text-gray-400">
                    <CalendarDays size={12} />
                    <span>
                      {new Date(t.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
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
