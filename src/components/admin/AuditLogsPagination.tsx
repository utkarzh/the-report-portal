'use client'

import { useRouter } from 'next/navigation'

const PAGE_SIZE = 20

interface Props {
  page: number
  totalPages: number
  totalCount: number
}

function buildUrl(p: number) {
  const params = new URLSearchParams()
  params.set('page', String(p))
  return `/admin/audit-logs?${params.toString()}`
}

export default function AuditLogsPagination({ page, totalPages, totalCount }: Props) {
  const router = useRouter()
  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, totalCount)

  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-xs text-gray-400">
        Showing {start}–{end} of {totalCount} sign-ins
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
              p === page
                ? 'bg-black text-white border-black'
                : 'bg-white border-[#e5e3df] text-gray-600 hover:border-gray-400'
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
