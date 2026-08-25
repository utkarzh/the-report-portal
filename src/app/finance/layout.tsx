import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { canAccessFinance } from '@/lib/access'

// Access gate only — no visual chrome here. /finance/(field) and
// /finance/admin each render their own complete shell (different nav per
// persona), so this parent layout must stay UI-less or both would nest.
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (!canAccessFinance(profile)) redirect('/dashboard')

  return <>{children}</>
}
