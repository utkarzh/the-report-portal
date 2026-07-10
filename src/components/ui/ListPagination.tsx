'use client'

import { useRouter } from 'next/navigation'

interface Props {
  page: number
  totalPages: number
  totalCount: number
  pageSize: number
  basePath: string
  label: string
}

// Windowed page list: always show first + last, plus the current page and its
// neighbours, collapsing the rest into ellipses. Keeps the control compact even
// with many pages.
function pageItems(page: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = [...new Set([1, total, page, page - 1, page + 1])]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  let prev = 0
  for (const p of pages) {
    if (prev && p - prev > 1) out.push('gap')
    out.push(p)
    prev = p
  }
  return out
}

export default function ListPagination({ page, totalPages, totalCount, pageSize, basePath, label }: Props) {
  const router = useRouter()
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalCount)
  const go = (p: number) => router.push(`${basePath}?page=${p}`)

  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-gray-400">
        Showing {start}–{end} of {totalCount} {label}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-[#e5e3df] bg-white px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Prev
        </button>

        {pageItems(page, totalPages).map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className="px-2 text-xs text-gray-300 select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => go(p)}
              className={`min-w-[32px] rounded-md border px-3 py-1.5 text-xs transition-colors ${
                p === page
                  ? 'border-black bg-black text-white'
                  : 'border-[#e5e3df] bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              {p}
            </button>
          ),
        )}

        <button
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md border border-[#e5e3df] bg-white px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  )
}
