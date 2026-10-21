export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import SectionLibraryManager from '@/components/copywriting/SectionLibraryManager'
import type { CopywritingLibrarySection } from '@/types'

export default async function CopywritingSectionsAdminPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/copywriting')

  const supabase = createSupabaseServerClient()
  const { data } = await supabase.from('copywriting_sections').select('*').order('name')

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-3xl mx-auto">
        <Breadcrumbs items={[{ label: 'Copywriting Tool', href: '/copywriting' }, { label: 'Admin', href: '/copywriting/admin' }, { label: 'Sections' }]} />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Sections</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The building blocks of an article. Writers drag these into the order they want when configuring a draft, and give each one the
            number of characters that article needs — the same section can be short in one article and long in another.
          </p>
        </div>

        <SectionLibraryManager initial={(data || []) as CopywritingLibrarySection[]} />
      </div>
    </div>
  )
}
