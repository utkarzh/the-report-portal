'use client'

import { useRouter } from 'next/navigation'

interface Props {
  page: number
  totalPages: number
  totalCount: number
  search: string
  role: string
}

function buildUrl(p: number, search: string, role: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (role) params.set('role', role)
  params.set('page', String(p))
  return `/admin/users?${params.toString()}`
}

export default function UsersPagination({ page, totalPages, totalCount, search, role }: Props) {
  const router = useRouter()
  const start = (page - 1) * 10 + 1
  const end = Math.min(page * 10, totalCount)

  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-xs text-gray-400">
        Showing {start}–{end} of {totalCount} users
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => router.push(buildUrl(page - 1, search, role))}
          disabled={page <= 1}
          className="px-3 py-1.5 text-xs bg-white border border-[#e5e3df] text-gray-600 hover:border-gray-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>

        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <button
            key={p}
            onClick={() => router.push(buildUrl(p, search, role))}
            className={`px-3 py-1.5 text-xs border transition-colors ${
              p === page
                ? 'bg-black text-white border-black'
                : 'bg-white border-[#e5e3df] text-gray-600 hover:border-gray-400'
            }`}
          >
            {p}
          </button>
        ))}

        <button
          onClick={() => router.push(buildUrl(page + 1, search, role))}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-xs bg-white border border-[#e5e3df] text-gray-600 hover:border-gray-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
    </div>
  )
}
