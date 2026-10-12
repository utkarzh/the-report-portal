import { requireAdminHeader } from '@/lib/auth/session'

// Access gate only — no visual chrome here. The parent /commercial layout
// already renders CommercialShell for every page in the domain; this just
// adds the stricter platform-admin check these config pages need (mirrors
// finance/layout.tsx being UI-less while finance/admin adds its own gate).
export default function CommercialAdminLayout({ children }: { children: React.ReactNode }) {
  requireAdminHeader()
  return <>{children}</>
}
