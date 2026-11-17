export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireSalesCoachAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { SALES_COACH_KNOWLEDGE_DOCS, SALES_COACH_LIVE_COACH_DOC } from '@/lib/sales-coach'

export default async function SalesCoachAdminPage() {
  requireSalesCoachAdminHeader()

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
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Sales Coach', href: '/commercial/sales-coach' },
            { label: 'Admin' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Sales Coach — Admin</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Manage the five TRC knowledge documents the coach reasons from and how the Live Coach talks, and read each Sales
            Executive&apos;s Report Cards together for patterns.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Knowledge Documents</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Assembled in this fixed authority order for every Report Card and coaching turn — the Project Prompt
              governs, then the Manual, then the Method. The Examples are for pattern recognition only, and the
              Follow-Up Playbook is used only when coaching the next commercial action, never for scoring. Every
              update is versioned with full rollback.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {SALES_COACH_KNOWLEDGE_DOCS.map(({ key, label, description }, i) => (
                <Link
                  key={key}
                  href={`/commercial/admin/sales-coach/knowledge/${key}`}
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
            <h2 className="text-sm font-semibold text-gray-900">Live Coach</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              How the coach sounds and behaves on a live voice call: its energy, how long each answer is, how it opens the call
              and how it role-plays. Used only on live calls, never for Report Cards, so editing it can&apos;t change a score.
              Versioned with full rollback.
            </p>
            <Link
              href={`/commercial/admin/sales-coach/knowledge/${SALES_COACH_LIVE_COACH_DOC.key}`}
              className="flex items-center justify-between gap-4 px-4 py-3 mt-4 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="sc-live-orb flex-shrink-0 w-5 h-5 rounded-full" />
                <span className="min-w-0">
                  <span className="block font-medium">{SALES_COACH_LIVE_COACH_DOC.label}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">Delivery on live voice calls only</span>
                </span>
              </span>
              <span aria-hidden className="flex-shrink-0">→</span>
            </Link>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Sales Performance Reports</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Pick a Sales Executive and their last 5, 10, 20 or all Report Cards: see an instant snapshot, then let the AI read
              them together for recurring strengths, gaps, trend, objections and a coaching plan. Every report is kept.
            </p>
            <Link
              href="/commercial/admin/sales-coach/patterns"
              className="flex items-center justify-between px-4 py-3 mt-4 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
            >
              <span>Open Sales Performance Reports</span>
              <span aria-hidden>→</span>
            </Link>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Negotiations</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Browse every negotiation submitted across the team, and see which ones have a fact correction on record
              or a criterion the coach marked unverifiable. Visibility only — declared outcomes are never disputed here.
            </p>
            <Link
              href="/commercial/admin/sales-coach/negotiations"
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
