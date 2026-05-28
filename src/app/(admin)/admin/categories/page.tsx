export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Link from 'next/link'
import DeleteCategoryButton from '@/components/admin/DeleteCategoryButton'
import type { Category } from '@/types'

export default async function CategoriesPage() {
  requireAdminHeader()

  const { data: categories } = await supabaseAdmin
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">

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

        {(!categories || categories.length === 0) ? (
          <div className="bg-white border border-[#e5e3df] p-10 text-center">
            <p className="text-sm text-gray-400">No categories yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(categories || []).map((cat: Category) => (
              <div
                key={cat.id}
                className="flex items-center justify-between p-4 sm:p-5 bg-white border border-[#e5e3df]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900">{cat.name}</p>
                    {!cat.is_active && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5">
                        Inactive
                      </span>
                    )}
                  </div>
                  {cat.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate max-w-lg">{cat.description}</p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-1">
                    {cat.prompt_text.length.toLocaleString()} chars in prompt
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  <Link
                    href={`/admin/categories/${cat.id}`}
                    className="text-xs text-gray-500 hover:text-black transition-colors px-3 py-1.5 border border-[#e5e3df] hover:border-gray-400"
                  >
                    Edit
                  </Link>
                  <DeleteCategoryButton categoryId={cat.id} categoryName={cat.name} />
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
