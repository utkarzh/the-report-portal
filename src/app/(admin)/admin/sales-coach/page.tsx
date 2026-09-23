export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { SALES_COACH_KNOWLEDGE_DOCS } from '@/lib/sales-coach'

export default async function SalesCoachAdminPage() {
  requireAdminHeader()

  // Flagged = a fact correction on record or a criterion needing audio
  // verification. Fetched (capped, not paginated — same reasoning as the
  // Negotiations list) rather than filtered in SQL, since it spans a jsonb
  // array column and a related table's count.
  const { data: rows } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('uv_criteria, sales_coach_corrections(count)')
    .limit(200)
  const flaggedCount = (rows || []).filter((r) => {
    const correctionsCount = Array.isArray(r.sales_coach_corrections) ? (r.sales_coach_corrections[0]?.count ?? 0) : 0
    return (r.uv_criteria?.length || 0) > 0 || correctionsCount > 0
  }).length

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Sales Coach', href: '/sales-coach' },
            { label: 'Admin' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Sales Coach — Admin</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Manage the four TRC knowledge documents the coach reasons from.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Knowledge Documents</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Assembled in this fixed authority order for every Report Card and coaching turn — the Project Prompt
              governs, then the Manual, then the Method. The Examples are for pattern recognition only. Every update
              is versioned with full rollback.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {SALES_COACH_KNOWLEDGE_DOCS.map(({ key, label, description }, i) => (
                <Link
                  key={key}
                  href={`/admin/sales-coach/knowledge/${key}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
                >
                  <span className="flex items-start gap-3 min-w-0">
                    <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-black text-white text-[10px] font-semibold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{label}</span>
                      <span className="block text-xs text-gray-500 mt-0.5">{description}</span>
                    </span>
                  </span>
                  <span aria-hidden className="flex-shrink-0">→</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Negotiations</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Browse every negotiation submitted across the team, and see which ones have a fact correction on record
              or a criterion the coach marked unverifiable. Visibility only — declared outcomes are never disputed here.
            </p>
            <Link
              href="/admin/sales-coach/negotiations"
              className="flex items-center justify-between px-4 py-3 mt-4 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
            >
              <span>
                Flagged{' '}
                <span className={flaggedCount ? 'text-[#a07530] font-medium' : 'text-gray-400'}>({flaggedCount})</span>
              </span>
              <span aria-hidden>→</span>
            </Link>
          </section>
        </div>
      </div>
    </div>
  )
}
