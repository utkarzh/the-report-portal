export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import PublicationsManager from '@/components/copywriting/PublicationsManager'

export default async function CopywritingPublicationsAdminPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/copywriting')

  const supabase = createSupabaseServerClient()
  const { data } = await supabase
    .from('copywriting_publications')
    .select('*, copywriting_publication_guides(id, filename, char_count, truncated, created_at)')
    .order('name')

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-4xl mx-auto">
        <Breadcrumbs items={[{ label: 'Copywriting Tool', href: '/copywriting' }, { label: 'Admin', href: '/copywriting/admin' }, { label: 'Publication' }]} />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Publications</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Add publications, their country, optional style guide attachments, and additional rules that apply on top of TRC house rules.
          </p>
        </div>

        <PublicationsManager initial={data || []} />
      </div>
    </div>
  )
}
