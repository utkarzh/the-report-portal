import { getProfileFromHeaders, requireFinanceAdminHeader } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import FinanceShell from '@/components/finance/FinanceShell'

export default async function FinanceAdminLayout({ children }: { children: React.ReactNode }) {
  requireFinanceAdminHeader()
  const profile = getProfileFromHeaders()

  // Review now happens inline on each project's own page, not a separate
  // global queue — the badge on Overview is just "something needs you."
  const supabase = createSupabaseServerClient()
  const { count: pendingCount } = await supabase
    .from('finance_expenses')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  return (
    <FinanceShell
      navItems={[
        { label: 'Overview', href: '/finance/admin', icon: 'layout-grid', badge: pendingCount ?? 0 },
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
