export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { aperturaSamplesAvailable, loadAdvertiserRecord, sampleRecordingUrl } from '@/lib/meeting-prep-server'
import MeetingPrepWorkspace from '@/components/meeting-prep/MeetingPrepWorkspace'
import type { MeetingPrepSession } from '@/types'

interface Props {
  params: { id: string }
}

export default async function MeetingPrepDetailPage({ params }: Props) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: session } = await supabase
    .from('meeting_prep_sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!session) notFound()

  // The reference recording (shown under the planteo script, and only there)
  // and which apertura sample files exist, for the aperturador's downloads.
  // Short-lived signed URL from the private bucket; a missing file just
  // means nothing renders.
  const [recordingUrl, samples, advertiser] = await Promise.all([
    sampleRecordingUrl(),
    session.interviewee_type === 'aperturador'
      ? aperturaSamplesAvailable()
      : Promise.resolve({ apertura_letter: false, apertura_list: false }),
    loadAdvertiserRecord(session as MeetingPrepSession),
  ])

  return (
    <MeetingPrepWorkspace
      session={session as MeetingPrepSession}
      isAdmin={profile.role === 'admin'}
      recordingUrl={recordingUrl}
      samples={samples}
      advertiser={advertiser}
    />
  )
}
