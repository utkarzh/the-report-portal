export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { TRANSCRIPTION_AUDIO_BUCKET } from '@/lib/transcriptions'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import TranscriptionWorkspace from '@/components/transcriptions/TranscriptionWorkspace'
import type { Transcription } from '@/types'

export default async function TranscriptionDetailPage({ params }: { params: { id: string } }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  // RLS: a user only sees their own row; an admin sees all.
  const supabase = createSupabaseServerClient()
  const { data } = await supabase
    .from('transcriptions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!data) notFound()
  const transcription = data as Transcription

  // Short-lived signed URL for the private audio object (service role).
  const { data: signed } = await supabaseAdmin
    .storage
    .from(TRANSCRIPTION_AUDIO_BUCKET)
    .createSignedUrl(transcription.audio_path, 60 * 60)

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="mx-auto max-w-4xl">
        <Breadcrumbs
          items={[
            { label: 'Transcriptions', href: '/transcriptions' },
            { label: transcription.title },
          ]}
        />
        <TranscriptionWorkspace
          transcription={transcription}
          audioUrl={signed?.signedUrl ?? null}
        />
      </div>
    </div>
  )
}
