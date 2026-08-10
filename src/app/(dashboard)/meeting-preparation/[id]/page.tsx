export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
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

  return (
    <MeetingPrepWorkspace
      session={session as MeetingPrepSession}
      isGenerating={searchParams.generating === 'true'}
      isAdmin={profile.role === 'admin'}
    />
  )
}
