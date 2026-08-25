import { getProfileFromHeaders } from '@/lib/auth/session'
import FinanceShell from '@/components/finance/FinanceShell'

export default function FinanceFieldLayout({ children }: { children: React.ReactNode }) {
  const profile = getProfileFromHeaders()

  return (
    <FinanceShell
      navItems={[{ label: 'My Projects', href: '/finance', icon: 'folder-kanban' }]}
      personaLabel="Field"
      userName={profile?.full_name ?? null}
    >
      {children}
    </FinanceShell>
  )
}
