export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { MEETING_PREP_SAMPLE_AUDIO_BUCKET, MEETING_PREP_SAMPLE_AUDIO_PATH } from '@/lib/meeting-prep'
import MeetingPrepWorkspace from '@/components/meeting-prep/MeetingPrepWorkspace'
import type { MeetingPrepSession } from '@/types'

interface Props {
  params: { id: string }
  searchParams: { generating?: string }
}

export default async function MeetingPrepDetailPage({ params, searchParams }: Props) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: session } = await supabase
    .from('meeting_prep_sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!session) notFound()

  // Short-lived signed URL for the reference planteo recording (private
  // bucket, service role). Missing file just means no player renders.
  const { data: signedSample } = await supabaseAdmin
    .storage
    .from(MEETING_PREP_SAMPLE_AUDIO_BUCKET)
    .createSignedUrl(MEETING_PREP_SAMPLE_AUDIO_PATH, 60 * 60)

  return (
    <MeetingPrepWorkspace
      session={session as MeetingPrepSession}
      isGenerating={searchParams.generating === 'true'}
      isAdmin={profile.role === 'admin'}
      sampleAudioUrl={signedSample?.signedUrl ?? null}
    />
  )
}
