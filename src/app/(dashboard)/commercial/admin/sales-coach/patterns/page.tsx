export const dynamic = 'force-dynamic'

import { requireSalesCoachAdminHeader } from '@/lib/auth/session'
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

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="max-w-6xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Sales Coach', href: '/commercial/sales-coach' },
            { label: 'Admin', href: '/commercial/admin/sales-coach' },
            { label: 'Pattern Analysis' },
          ]}
        />
        <SalesCoachPatterns executives={executives} initialUserId={initialUserId} />
      </div>
    </div>
  )
}
