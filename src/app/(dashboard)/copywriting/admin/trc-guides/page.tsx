export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import TrcGuidesManager from '@/components/copywriting/TrcGuidesManager'

export default async function CopywritingTrcGuidesAdminPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/copywriting')

  const supabase = createSupabaseServerClient()
  const { data: articleTypes } = await supabase.from('copywriting_article_types').select('id, name').order('name')

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-4xl mx-auto">
        <Breadcrumbs items={[{ label: 'Copywriting Tool', href: '/copywriting' }, { label: 'Admin', href: '/copywriting/admin' }, { label: 'TRC Guides' }]} />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">TRC Guides</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Configure TRC style guides and approved worked examples per article type — independent of any publication.
          </p>
        </div>

        {(!articleTypes || articleTypes.length === 0) ? (
          <p className="text-sm text-gray-400">Add an article type first.</p>
        ) : (
          <TrcGuidesManager articleTypes={articleTypes} />
        )}
      </div>
    </div>
  )
}
