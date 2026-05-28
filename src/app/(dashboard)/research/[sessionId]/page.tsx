import { redirect, notFound } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import ResearchOutput from '@/components/research/ResearchOutput'
import type { ResearchSession } from '@/types'

interface Props {
  params: { sessionId: string }
  searchParams: { generating?: string }
}

export default async function ResearchSessionPage({ params, searchParams }: Props) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()

  const { data: session } = await supabase
    .from('research_sessions')
    .select('*')
    .eq('id', params.sessionId)
    .single()

  if (!session) notFound()

  if (session.user_id !== profile.id && profile.role !== 'admin') {
    redirect('/dashboard')
  }

  const isGenerating = searchParams.generating === 'true'

  return (
    <ResearchOutput
      session={session as ResearchSession}
      isGenerating={isGenerating}
    />
  )
}
