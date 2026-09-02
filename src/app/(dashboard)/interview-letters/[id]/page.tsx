export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import InterviewLetterWorkspace from '@/components/interview-letters/InterviewLetterWorkspace'
import type { InterviewLetterProject } from '@/types'

interface Props {
  params: { id: string }
  searchParams: { generating?: string }
}

export default async function InterviewLetterDetailPage({ params, searchParams }: Props) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: project } = await supabase
    .from('interview_letter_projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!project) notFound()

  return (
    <InterviewLetterWorkspace
      project={project as InterviewLetterProject}
      isGenerating={searchParams.generating === 'true'}
      isAdmin={profile.role === 'admin'}
    />
  )
}
