export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import ArticleTypesManager from '@/components/copywriting/ArticleTypesManager'

export default async function CopywritingArticleTypesAdminPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/copywriting')

  const supabase = createSupabaseServerClient()
  const { data } = await supabase.from('copywriting_article_types').select('*').order('name')

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-4xl mx-auto">
        <Breadcrumbs items={[{ label: 'Copywriting Tool', href: '/copywriting' }, { label: 'Admin', href: '/copywriting/admin' }, { label: 'Article Type' }]} />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Article Types</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The article types writers can choose from when configuring a new draft, each with its own optional additional instructions.
          </p>
        </div>

        <ArticleTypesManager initial={data || []} />
      </div>
    </div>
  )
}
