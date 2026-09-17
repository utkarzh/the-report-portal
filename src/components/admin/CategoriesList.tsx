'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, X } from 'lucide-react'
import DeleteCategoryButton from '@/components/admin/DeleteCategoryButton'
import type { Category } from '@/types'

// The full category list is already fetched server-side (there's no pagination
// here — categories are a short admin config list, not a "many rows" table),
// so filtering happens instantly in the browser: no debounce, no navigation,
// no loading state at all.
export default function CategoriesList({ categories }: { categories: Category[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return categories
    return categories.filter(
      (cat) => cat.name.toLowerCase().includes(q) || (cat.description || '').toLowerCase().includes(q),
    )
  }, [categories, query])

  return (
    <div>
      <div className="relative mb-5 max-w-sm">
        <Search className="pointer-events-none absolute left-4 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search categories..."
          aria-label="Search categories"
          className="w-full rounded-full border border-[#e5e3df] bg-white py-2.5 pl-10 pr-9 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-300 transition-colors hover:text-gray-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {categories.length === 0 ? (
        <div className="bg-white border border-[#e5e3df] p-10 text-center">
          <p className="text-sm text-gray-400">No categories yet. Create one to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-[#e5e3df] p-10 text-center">
          <p className="text-sm text-gray-400">
            No categories match &ldquo;<span className="font-medium text-gray-600">{query}</span>&rdquo;.{' '}
            <button onClick={() => setQuery('')} className="text-gray-600 underline hover:text-black">Clear search</button>
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((cat) => (
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
  )
}
