export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Flag } from 'lucide-react'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import SalesCoachNegotiationsTable from '@/components/admin/SalesCoachNegotiationsTable'

interface Props {
  searchParams: { flagged?: string }
}

// Admins browsing every negotiation across the team, with visibility into
// which ones have a fact correction on record or a criterion the coach
// marked unverifiable (uv). This is visibility only — there is no
// outcome-disputing here, unlike the management-review mechanism removed in
// commit cc1b0b6 at the client's own request. Declared outcomes stay trusted
// outright; this page never second-guesses one.
export default async function SalesCoachNegotiationsAdminPage({ searchParams }: Props) {
  requireAdminHeader()

  const flaggedOnly = searchParams.flagged === '1'

  const { data: rows } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('id, company, country, media_publication, submitted_by_name, declared_outcome, execution_score, execution_denominator, uv_criteria, stage, created_at, sales_coach_corrections(count)')
    .order('created_at', { ascending: false })
    .limit(200)

  const withFlags = (rows || []).map((r) => ({
    ...r,
    corrections_count: Array.isArray(r.sales_coach_corrections) ? (r.sales_coach_corrections[0]?.count ?? 0) : 0,
  }))
  const filtered = flaggedOnly
    ? withFlags.filter((r) => (r.uv_criteria?.length || 0) > 0 || r.corrections_count > 0)
    : withFlags

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
            <h1 className="text-lg font-semibold text-gray-900">Negotiations</h1>
            <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
              Every negotiation submitted across the team. Flagged means the Sales Executive has corrected a fact the
              coach got wrong, or a criterion needs audio verification — not an outcome dispute.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-[#e5e3df] bg-white p-1 text-xs font-medium">
            <Link
              href="/admin/sales-coach/negotiations"
              className={`rounded-md px-3 py-1.5 transition-colors ${!flaggedOnly ? 'bg-black text-white' : 'text-gray-600 hover:text-black'}`}
            >
              All
            </Link>
            <Link
              href="/admin/sales-coach/negotiations?flagged=1"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${flaggedOnly ? 'bg-black text-white' : 'text-gray-600 hover:text-black'}`}
            >
              <Flag size={12} /> Flagged
            </Link>
          </div>
        </div>

        {(!rows || rows.length === 0) ? (
          <div className="rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500">
            No negotiations have been submitted yet.
          </div>
        ) : (
          <SalesCoachNegotiationsTable rows={filtered} flaggedOnly={flaggedOnly} />
        )}
      </div>
    </div>
  )
}
