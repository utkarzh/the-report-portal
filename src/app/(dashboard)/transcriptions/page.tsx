export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, AudioLines, WandSparkles, CheckCircle2, Loader2, AlertCircle, Sparkles, ShieldCheck } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { reconcilePendingTranscriptions } from '@/lib/assemblyai/reconcile'
import DeleteTranscriptionButton from '@/components/transcriptions/DeleteTranscriptionButton'
import ListPagination from '@/components/ui/ListPagination'
import EntityCard from '@/components/ui/EntityCard'
import StatusPill, { type PillTone } from '@/components/ui/StatusPill'
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
        <div className="mb-6 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 rounded-lg bg-[#c8973f]/10 p-2 text-[#a07530]">
                <ShieldCheck size={18} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">Admin tools</p>
                <p className="text-sm text-gray-600 mt-0.5">Manage the prompt used to refine transcripts with AI.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/transcript-prompt" className="group inline-flex items-center gap-2 rounded-lg border border-[#c8973f]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c8973f]/50 hover:text-[#a07530] hover:shadow">
                <WandSparkles size={14} className="text-[#a07530]" />
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
          {rows.map((t, i) => (
            <EntityCard
              key={t.id}
              index={i}
              href={`/transcriptions/${t.id}`}
              icon={<AudioLines size={16} />}
              title={t.title}
              subtitle={t.audio_filename || 'audio'}
              date={new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              creatorName={t.creatorName}
              badge={<StatusBadge status={t.status as TranscriptionStatus} />}
              metaRight={
                isAdmin && Number(t.cost_usd) > 0 ? (
                  <span
                    title="AI (Claude) cost for refine & translation"
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-[#f7f6f3] px-2 py-0.5 text-[11px] font-medium text-gray-600 tabular-nums"
                  >
                    <Sparkles size={10} />${Number(t.cost_usd).toFixed(4)}
                  </span>
                ) : undefined
              }
              footerLabel="View transcript"
              deleteSlot={profile.role === 'admin' ? <DeleteTranscriptionButton transcriptionId={t.id} transcriptionTitle={t.title} variant="icon" /> : undefined}
            />
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
  const map: Record<TranscriptionStatus, { label: string; tone: PillTone; icon?: React.ReactNode }> = {
    uploaded: { label: 'Queued', tone: 'stone' },
    transcribing: { label: 'Transcribing', tone: 'amber', icon: <Loader2 size={12} className="animate-spin" /> },
    transcribed: { label: 'Transcribed', tone: 'sky', icon: <CheckCircle2 size={12} /> },
    refining: { label: 'Refining', tone: 'amber', icon: <Loader2 size={12} className="animate-spin" /> },
    refined: { label: 'Refined', tone: 'emerald', icon: <CheckCircle2 size={12} /> },
    failed: { label: 'Failed', tone: 'red', icon: <AlertCircle size={12} /> },
  }
  const s = map[status] ?? map.uploaded
  return <StatusPill label={s.label} tone={s.tone} icon={s.icon} />
}
