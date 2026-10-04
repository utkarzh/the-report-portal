export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import NewProjectForm from '@/components/copywriting/NewProjectForm'

export default async function NewCopywritingProjectPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  const [{ data: publications }, { data: articleTypes }] = await Promise.all([
    supabase.from('copywriting_publications').select('id, name').order('name'),
    supabase.from('copywriting_article_types').select('id, name').order('name'),
  ])

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs items={[{ label: 'Copywriting Tool', href: '/copywriting' }, { label: 'New Draft' }]} />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Configure a new article</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Set the basics — the tool applies TRC house rules, the publication guide, and the article type's guides
            automatically once you get started.
          </p>
        </div>

        {(!publications || publications.length === 0 || !articleTypes || articleTypes.length === 0) && (
          <p className="mb-6 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-4 py-3">
            {!publications?.length && 'No publications configured yet. '}
            {!articleTypes?.length && 'No article types configured yet. '}
            An admin can add these from the Admin area.
          </p>
        )}

        <NewProjectForm publications={publications || []} articleTypes={articleTypes || []} />
      </div>
    </div>
  )
}
