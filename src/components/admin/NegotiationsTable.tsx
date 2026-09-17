'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, X, Flag, CheckCircle2 } from 'lucide-react'
import { SALES_COACH_STAGE_LABELS, formatScore, outcomeLabel, reviewStatus } from '@/lib/sales-coach'
import type { SalesCoachStage } from '@/types'

interface NegotiationRow {
  id: string
  company: string | null
  country: string | null
  media_publication: string | null
  submitted_by_name: string | null
  declared_outcome: string
  ai_assessed_position: string | null
  execution_score: number | null
  execution_denominator: number | null
  stage: string
  management_review: boolean
  actual_outcome: string | null
  actual_outcome_at: string | null
  created_at: string
}

// The page fetches at most 200 rows (capped, not paginated), so filtering
// happens instantly in the browser: no debounce, no navigation, no loading
// state at all — the same reasoning as CategoriesList.
export default function NegotiationsTable({ rows, reviewOnly }: { rows: NegotiationRow[]; reviewOnly: boolean }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.company, r.submitted_by_name, r.country, r.media_publication, r.ai_assessed_position]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    )
  }, [rows, query])

  return (
    <div>
      <div className="relative mb-5 max-w-sm">
        <Search className="pointer-events-none absolute left-4 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by company, submitter, country..."
          aria-label="Search negotiations"
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

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500">
          {reviewOnly ? 'Nothing is waiting for management review.' : 'No negotiations have been submitted yet.'}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500">
          No negotiations match &ldquo;<span className="font-medium text-gray-700">{query}</span>&rdquo;.{' '}
          <button onClick={() => setQuery('')} className="text-gray-700 underline hover:text-black">Clear search</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e5e3df] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e3df] bg-[#faf9f7] text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Submitted by</th>
                <th className="px-4 py-3">Declared</th>
                <th className="px-4 py-3">AI-assessed</th>
                <th className="px-4 py-3 text-right">Score</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-[#f0eee9] last:border-b-0 hover:bg-[#faf9f7]">
                  <td className="px-4 py-3">
                    <Link href={`/sales-coach/${r.id}`} className="font-medium text-gray-900 hover:underline">
                      {r.company || 'Untitled negotiation'}
                    </Link>
                    <div className="text-xs text-gray-400 truncate">
                      {[r.country, r.media_publication].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {reviewStatus(r) === 'open' && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#fbf7ed] px-2 py-0.5 text-[10px] font-medium text-[#a07530]">
                        <Flag size={10} /> Needs review
                      </span>
                    )}
                    {reviewStatus(r) === 'reviewed' && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        <CheckCircle2 size={10} /> Reviewed · {outcomeLabel(r.actual_outcome as never)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.submitted_by_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{outcomeLabel(r.declared_outcome as never)}</td>
                  <td className="px-4 py-3 text-gray-700">{r.ai_assessed_position || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                    {typeof r.execution_score === 'number' && typeof r.execution_denominator === 'number'
                      ? formatScore(Number(r.execution_score), r.execution_denominator)
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-[#e5e3df] bg-[#f7f6f3] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                      {SALES_COACH_STAGE_LABELS[r.stage as SalesCoachStage] || r.stage}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
