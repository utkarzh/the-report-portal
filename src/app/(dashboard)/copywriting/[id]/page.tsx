export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import ProjectWorkspace from '@/components/copywriting/ProjectWorkspace'
import { loadProjectImages } from '@/lib/copywriting-images'

export default async function CopywritingProjectPage({ params }: { params: { id: string } }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: project } = await supabase.from('copywriting_projects').select('*').eq('id', params.id).maybeSingle()
  if (!project) notFound()
  if (project.user_id !== profile.id && profile.role !== 'admin') redirect('/copywriting')

  const [{ data: documents }, { data: research }, { data: messages }, { data: events }] = await Promise.all([
    supabase.from('copywriting_project_documents').select('id, project_id, user_id, filename, storage_path, mime, size_bytes, char_count, truncated, created_at').eq('project_id', project.id).order('created_at'),
    supabase.from('copywriting_research_entries').select('*').eq('project_id', project.id).order('created_at'),
    supabase.from('copywriting_messages').select('*').eq('project_id', project.id).order('created_at'),
    supabase.from('copywriting_project_events').select('*').eq('project_id', project.id).order('created_at'),
  ])
  // Access was checked above (owner or admin), so the service-role signed
  // URLs this returns are safe to hand to this viewer.
  const images = await loadProjectImages(project.id)

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <Breadcrumbs items={[{ label: 'Copywriting Tool', href: '/copywriting' }, { label: project.draft_name }]} />
        <h1 className="text-lg font-semibold text-gray-900 mb-8">{project.draft_name}</h1>

        <ProjectWorkspace
          projectId={project.id}
          isAdmin={profile.role === 'admin'}
          initial={{
            project,
            documents: documents || [],
            research: research || [],
            messages: messages || [],
            events: events || [],
            images,
          }}
        />
      </div>
    </div>
  )
}
