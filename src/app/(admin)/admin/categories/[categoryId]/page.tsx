export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import CategoryForm from '@/components/admin/CategoryForm'
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

        <div className="mb-8">
          <Link
            href="/admin/categories"
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1 mb-4"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Categories
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">Edit Category</h1>
          <p className="text-sm text-gray-500 mt-1.5">{category.name}</p>
        </div>

        <CategoryForm category={category as Category} />

      </div>
    </div>
  )
}
