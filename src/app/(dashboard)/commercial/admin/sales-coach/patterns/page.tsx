export const dynamic = 'force-dynamic'

import { getProfileFromHeaders, requireSalesCoachAdminHeader } from '@/lib/auth/session'
import { canDownloadPatternPdf } from '@/lib/sales-coach-admins'
import { loadPatternExecutives } from '@/lib/sales-coach-patterns-server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import SalesCoachPatterns from '@/components/admin/SalesCoachPatterns'

interface Props {
  searchParams: { user?: string }
}

// Pattern Analysis (13 Nov 2026): one Sales Executive's Report Cards read
// together. Sales Coach admins only (the allowlist, via this section's layout).
export default async function SalesCoachPatternsPage({ searchParams }: Props) {
  requireSalesCoachAdminHeader()
  const executives = await loadPatternExecutives()
  const initialUserId = executives.some((e) => e.id === searchParams.user) ? searchParams.user! : null
  // The PDF report is narrower than the page: two accounts only.
  const canDownloadPdf = canDownloadPatternPdf(getProfileFromHeaders()?.email)

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="max-w-6xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Sales Coach', href: '/commercial/sales-coach' },
            { label: 'Admin', href: '/commercial/admin/sales-coach' },
            { label: 'Sales Performance Reports' },
          ]}
        />
        <SalesCoachPatterns executives={executives} initialUserId={initialUserId} canDownloadPdf={canDownloadPdf} />
      </div>
    </div>
  )
}
