export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import CategoryForm from '@/components/admin/CategoryForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import type { Category } from '@/types'

interface Props {
  params: { categoryId: string }
}

export default async function EditCategoryPage({ params }: Props) {
  requireAdminHeader()

  const { data: category } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('id', params.categoryId)
    .single()

  if (!category) notFound()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">

        <Breadcrumbs
          items={[
            { label: 'Interview Tool', href: '/interview' },
            { label: 'Categories', href: '/admin/categories' },
            { label: 'Edit Category' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Edit Category</h1>
          <p className="text-sm text-gray-500 mt-1.5">{category.name}</p>
        </div>

        <CategoryForm category={category as Category} />

      </div>
    </div>
  )
}
