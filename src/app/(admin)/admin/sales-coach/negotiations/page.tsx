export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Flag } from 'lucide-react'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft',
  transcribing: 'Transcribing',
  transcribed: 'Ready to analyse',
  analyzing: 'Analysing',
  complete: 'Complete',
  failed: 'Failed',
}

const OUTCOME_LABELS: Record<string, string> = {
  signed: 'Signed on the spot',
  retorno: 'Retorno',
  lost: 'Lost',
  uncertain: 'Uncertain',
}

interface Props {
  searchParams: { review?: string }
}

// US-045: the central negotiations database. Admins see every submission;
// `?review=1` narrows to those the analysis flagged for management review.
export default async function SalesCoachNegotiationsAdminPage({ searchParams }: Props) {
  requireAdminHeader()

  const reviewOnly = searchParams.review === '1'

  let query = supabaseAdmin
    .from('sales_coach_negotiations')
    .select('id, company, country, media_publication, submitted_by_name, declared_outcome, ai_assessed_position, execution_score, execution_denominator, stage, management_review, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (reviewOnly) query = query.eq('management_review', true)

  const { data: rows } = await query

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-6xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Sales Coach', href: '/sales-coach' },
            { label: 'Admin', href: '/admin/sales-coach' },
            { label: 'Negotiations' },
          ]}
        />

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Negotiations Database</h1>
            <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
              Every negotiation submitted across the team. The declared outcome and the AI-assessed position are kept
              distinct — a mismatch is what raises the management-review flag.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-[#e5e3df] bg-white p-1 text-xs font-medium">
            <Link
              href="/admin/sales-coach/negotiations"
              className={`rounded-md px-3 py-1.5 transition-colors ${!reviewOnly ? 'bg-black text-white' : 'text-gray-600 hover:text-black'}`}
            >
              All
            </Link>
            <Link
              href="/admin/sales-coach/negotiations?review=1"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${reviewOnly ? 'bg-black text-white' : 'text-gray-600 hover:text-black'}`}
            >
              <Flag size={12} /> Needs review
            </Link>
          </div>
        </div>

        {(!rows || rows.length === 0) ? (
          <div className="rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500">
            {reviewOnly ? 'No negotiations are flagged for management review.' : 'No negotiations have been submitted yet.'}
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
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[#f0eee9] last:border-b-0 hover:bg-[#faf9f7]">
                    <td className="px-4 py-3">
                      <Link href={`/sales-coach/${r.id}`} className="font-medium text-gray-900 hover:underline">
                        {r.company || 'Untitled negotiation'}
                      </Link>
                      <div className="text-xs text-gray-400 truncate">
                        {[r.country, r.media_publication].filter(Boolean).join(' · ') || '—'}
                      </div>
                      {r.management_review && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#fbf7ed] px-2 py-0.5 text-[10px] font-medium text-[#a07530]">
                          <Flag size={10} /> Management review
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.submitted_by_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{OUTCOME_LABELS[r.declared_outcome as string] || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.ai_assessed_position || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                      {typeof r.execution_score === 'number' && typeof r.execution_denominator === 'number'
                        ? `${r.execution_score}/${r.execution_denominator}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-[#e5e3df] bg-[#f7f6f3] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                        {STAGE_LABELS[r.stage] || r.stage}
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
    </div>
  )
}
