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
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-base font-semibold text-gray-900">Categories</h1>
        <Link
          href="/admin/categories/new"
          className="inline-flex items-center gap-2 bg-black text-white px-4 py-2 text-xs font-medium tracking-wider uppercase hover:bg-gray-900 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Category
        </Link>
      </div>

      <div className="space-y-2 max-w-2xl">
        {(!categories || categories.length === 0) && (
          <p className="text-sm text-gray-400 py-4">No categories yet.</p>
        )}
        {(categories || []).map((cat: Category) => (
          <div
            key={cat.id}
            className="flex items-center justify-between p-4 bg-white border border-[#e5e3df]"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{cat.name}</p>
              {cat.description && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">{cat.description}</p>
              )}
              <p className="text-[10px] text-gray-400 mt-1">
                {cat.prompt_text.length} chars in prompt
                {!cat.is_active && (
                  <span className="ml-2 text-amber-500 font-medium">Inactive</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 ml-4 flex-shrink-0">
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
    </div>
  )
}
