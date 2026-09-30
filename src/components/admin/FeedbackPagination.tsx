'use client'

import { useRouter } from 'next/navigation'

const PAGE_SIZE = 20

interface Props {
  page: number
  totalPages: number
  totalCount: number
  type?: string
  status?: string
}

export default function FeedbackPagination({ page, totalPages, totalCount, type, status }: Props) {
  const router = useRouter()
  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, totalCount)

  function buildUrl(p: number) {
    const params = new URLSearchParams()
    if (type) params.set('type', type)
    if (status) params.set('status', status)
    params.set('page', String(p))
    return `/admin/feedback?${params.toString()}`
  }

  return (
    <div className="mt-4 flex items-center justify-between">
      <p className="text-xs text-gray-400">
        Showing {start}–{end} of {totalCount}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => router.push(buildUrl(page - 1))}
          disabled={page <= 1}
          className="px-3 py-1.5 text-xs bg-white border border-[#e5e3df] text-gray-600 hover:border-gray-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <button
            key={p}
            onClick={() => router.push(buildUrl(p))}
            className={`px-3 py-1.5 text-xs border transition-colors ${
              p === page ? 'bg-black text-white border-black' : 'bg-white border-[#e5e3df] text-gray-600 hover:border-gray-400'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => router.push(buildUrl(page + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-xs bg-white border border-[#e5e3df] text-gray-600 hover:border-gray-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
    </div>
  )
}
