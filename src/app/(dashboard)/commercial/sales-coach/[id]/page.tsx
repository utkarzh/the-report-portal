export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { reconcilePendingNegotiations } from '@/lib/assemblyai/reconcile'
import { SALES_COACH_AUDIO_BUCKET, isMissingReevaluatedColumn } from '@/lib/sales-coach'
import { isSalesCoachAdminEmail } from '@/lib/sales-coach-admins'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import NegotiationWorkspace from '@/components/sales-coach/NegotiationWorkspace'
import DeleteNegotiationButton from '@/components/sales-coach/DeleteNegotiationButton'
import type { SalesCoachNegotiation, SalesCoachMessage, SalesCoachCorrection } from '@/types'

interface Props {
  params: { id: string }
  searchParams: { start?: string }
}

export default async function NegotiationDetailPage({ params, searchParams }: Props) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  // RLS scopes this to the owner; admins see every negotiation.
  const supabase = createSupabaseServerClient()
  const loadNegotiation = () =>
    supabase.from('sales_coach_negotiations').select('*').eq('id', params.id).single()
  let { data } = await loadNegotiation()
  if (!data) notFound()

  // Heal a transcription that finished on AssemblyAI while nobody was polling.
  // Only a row still at 'transcribing' with a job id can change, so the check
  // (and the re-read) is skipped for every other negotiation.
  if (data.stage === 'transcribing' && data.transcribe_job_id) {
    const healed = await reconcilePendingNegotiations({ id: params.id })
    if (healed > 0) data = (await loadNegotiation()).data ?? data
  }
  const n = data as SalesCoachNegotiation

  // Everything below depends only on `n`, so it's fetched in parallel: one
  // database round trip instead of five in a row.
  const [signed, msgResult, correctionResult, latestCopyResult, creator] = await Promise.all([
    // Short-lived signed URL for the private audio object (service role).
    n.audio_path
      ? supabaseAdmin.storage.from(SALES_COACH_AUDIO_BUCKET).createSignedUrl(n.audio_path, 60 * 60)
      : Promise.resolve(null),
    supabase
      .from('sales_coach_messages')
      .select('id, negotiation_id, role, content, created_at')
      .eq('negotiation_id', n.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('sales_coach_corrections')
      .select('*')
      .eq('negotiation_id', n.id)
      .order('created_at', { ascending: true }),
    // The newest "Re-evaluate" copy of this negotiation (all copies point at
    // the original), so an older card can point to it. Before migration 036 the
    // column doesn't exist — the query fails and there's simply no link.
    supabase
      .from('sales_coach_negotiations')
      .select('id')
      .eq('reevaluated_from', n.reevaluated_from || n.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Admins see who submitted it (same approach as the other modules).
    profile.role === 'admin' && n.user_id
      ? supabaseAdmin.from('profiles').select('full_name').eq('id', n.user_id).single()
      : Promise.resolve(null),
  ])

  const audioUrl: string | null = signed?.data?.signedUrl ?? null
  const messages = (msgResult.data || []) as SalesCoachMessage[]
  const corrections = (correctionResult.data || []) as SalesCoachCorrection[]

  let newerReevaluationId: string | null = null
  const { data: latestCopy, error: latestCopyError } = latestCopyResult
  if (latestCopy?.id && latestCopy.id !== n.id) newerReevaluationId = latestCopy.id
  else if (latestCopyError && !isMissingReevaluatedColumn(latestCopyError)) {
    console.error('Could not look up re-evaluations:', latestCopyError)
  }

  let creatorName: string | null = null
  if (profile.role === 'admin') {
    creatorName = n.user_id
      ? creator?.data?.full_name || n.submitted_by_name || 'Unknown user'
      : n.submitted_by_name ? `${n.submitted_by_name} (deleted user)` : 'Deleted user'
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-3">
          <Breadcrumbs items={[{ label: 'Sales Coach', href: '/commercial/sales-coach' }, { label: n.company || 'Negotiation' }]} />
          {profile.role === 'admin' && (
            <DeleteNegotiationButton negotiationId={n.id} title={n.company || 'this negotiation'} redirectTo="/commercial/sales-coach" />
          )}
        </div>
        {/* key: a fresh workspace per negotiation — moving from one negotiation
            straight to another (e.g. Re-evaluate opening its copy) must not
            carry the previous one's state or skip the copy's auto-start. */}
        <NegotiationWorkspace
          key={n.id}
          negotiation={n}
          messages={messages}
          corrections={corrections}
          audioUrl={audioUrl}
          canDownloadAudio={isSalesCoachAdminEmail(profile.email)}
          isAdmin={profile.role === 'admin'}
          autoStart={searchParams.start === '1'}
          creatorName={creatorName}
          newerReevaluationId={newerReevaluationId}
        />
      </div>
    </div>
  )
}
