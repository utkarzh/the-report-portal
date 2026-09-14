export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { reconcilePendingNegotiations } from '@/lib/assemblyai/reconcile'
import { SALES_COACH_AUDIO_BUCKET } from '@/lib/sales-coach'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import NegotiationWorkspace from '@/components/sales-coach/NegotiationWorkspace'
import DeleteNegotiationButton from '@/components/sales-coach/DeleteNegotiationButton'
import type { SalesCoachNegotiation, SalesCoachMessage } from '@/types'

interface Props {
  params: { id: string }
  searchParams: { start?: string }
}

export default async function NegotiationDetailPage({ params, searchParams }: Props) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  // Heal a transcription that finished on AssemblyAI while nobody was polling.
  await reconcilePendingNegotiations({ id: params.id })

  // RLS scopes this to the owner; admins see every negotiation.
  const supabase = createSupabaseServerClient()
  const { data } = await supabase
    .from('sales_coach_negotiations')
    .select('*')
    .eq('id', params.id)
    .single()
  if (!data) notFound()
  const n = data as SalesCoachNegotiation

  // Short-lived signed URL for the private audio object (service role).
  let audioUrl: string | null = null
  if (n.audio_path) {
    const { data: signed } = await supabaseAdmin
      .storage
      .from(SALES_COACH_AUDIO_BUCKET)
      .createSignedUrl(n.audio_path, 60 * 60)
    audioUrl = signed?.signedUrl ?? null
  }

  const { data: msgRows } = await supabase
    .from('sales_coach_messages')
    .select('id, negotiation_id, role, content, created_at')
    .eq('negotiation_id', n.id)
    .order('created_at', { ascending: true })
  const messages = (msgRows || []) as SalesCoachMessage[]

  // Admins see who submitted it (same approach as the other modules).
  let creatorName: string | null = null
  if (profile.role === 'admin') {
    if (n.user_id) {
      const { data: creator } = await supabaseAdmin.from('profiles').select('full_name').eq('id', n.user_id).single()
      creatorName = creator?.full_name || n.submitted_by_name || 'Unknown user'
    } else {
      creatorName = n.submitted_by_name ? `${n.submitted_by_name} (deleted user)` : 'Deleted user'
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-3">
          <Breadcrumbs items={[{ label: 'Sales Coach', href: '/sales-coach' }, { label: n.company || 'Negotiation' }]} />
          {profile.role === 'admin' && (
            <DeleteNegotiationButton negotiationId={n.id} title={n.company || 'this negotiation'} redirectTo="/sales-coach" />
          )}
        </div>
        <NegotiationWorkspace
          negotiation={n}
          messages={messages}
          audioUrl={audioUrl}
          isAdmin={profile.role === 'admin'}
          autoStart={searchParams.start === '1'}
          creatorName={creatorName}
        />
      </div>
    </div>
  )
}
