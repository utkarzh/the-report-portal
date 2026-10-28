import { getProfileFromHeaders, requireFinanceAdminHeader } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import FinanceShell from '@/components/finance/FinanceShell'

export default async function FinanceAdminLayout({ children }: { children: React.ReactNode }) {
  requireFinanceAdminHeader()
  const profile = getProfileFromHeaders()

  // Tickets waiting for review on open projects — the badge on the Review
  // queue, the one place that lists them across every project oldest-first
  // (client review, 26 Oct 2026: it used to be reachable only from the
  // Friday email). Closed projects don't count.
  const supabase = createSupabaseServerClient()
  const { count: pendingCount } = await supabase
    .from('finance_expenses')
    .select('id, finance_projects!inner(status)', { count: 'exact', head: true })
    .eq('status', 'pending')
    .eq('finance_projects.status', 'active')

  return (
    <FinanceShell
      navItems={[
        { label: 'Overview', href: '/finance/admin', icon: 'layout-grid' },
        { label: 'Review queue', href: '/finance/admin/review', icon: 'clipboard-check', badge: pendingCount ?? 0 },
        { label: 'Transfers', href: '/finance/admin/transfers', icon: 'arrow-left-right' },
        { label: 'Analytics', href: '/finance/admin/analytics', icon: 'bar-chart-3' },
      ]}
      personaLabel="Finance Admin"
      userName={profile?.full_name ?? null}
    >
      {children}
    </FinanceShell>
  )
}
