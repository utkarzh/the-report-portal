import { redirect, notFound } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import ResearchOutput from '@/components/research/ResearchOutput'
import type { ResearchSession, Message } from '@/types'

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

  // Only owner or admin can view
  if (session.user_id !== profile.id && profile.role !== 'admin') {
    redirect('/dashboard')
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', params.sessionId)
    .order('created_at', { ascending: true })

  const isGenerating = searchParams.generating === 'true'

  return (
    <ResearchOutput
      session={session as ResearchSession}
      messages={(messages || []) as Message[]}
      isGenerating={isGenerating}
    />
  )
}
