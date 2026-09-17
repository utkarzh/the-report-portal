export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Link from 'next/link'
import CategoriesList from '@/components/admin/CategoriesList'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

export default async function CategoriesPage() {
  requireAdminHeader()

  const { data: categories } = await supabaseAdmin
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">

        <Breadcrumbs
          items={[
            { label: 'Interview Tool', href: '/interview' },
            { label: 'Categories' },
          ]}
        />

        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Categories</h1>
            <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
              Each category has its own prompt that combines with the general prompt when generating research.
            </p>
          </div>
          <Link
            href="/admin/categories/new"
            className="inline-flex items-center gap-2 bg-black text-white px-4 py-2.5 text-xs font-medium tracking-wider uppercase hover:bg-gray-900 transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Category
          </Link>
        </div>

        <CategoriesList categories={categories || []} />

      </div>
    </div>
  )
}
