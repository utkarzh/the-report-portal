import { requireSalesCoachAdminHeader } from '@/lib/auth/session'

// Access gate only — Sales Coach admin is an explicit email allowlist, not the
// platform admin role (see sales-coach-admins.ts).
export default function SalesCoachAdminLayout({ children }: { children: React.ReactNode }) {
  requireSalesCoachAdminHeader()
  return <>{children}</>
}
