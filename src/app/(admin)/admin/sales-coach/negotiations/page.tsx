export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Flag } from 'lucide-react'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import NegotiationsTable from '@/components/admin/NegotiationsTable'

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
    .select('id, company, country, media_publication, submitted_by_name, declared_outcome, ai_assessed_position, execution_score, execution_denominator, stage, management_review, actual_outcome, actual_outcome_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (reviewOnly) query = query.eq('management_review', true).is('actual_outcome_at', null)

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

        <NegotiationsTable rows={rows || []} reviewOnly={reviewOnly} />
      </div>
    </div>
  )
}
