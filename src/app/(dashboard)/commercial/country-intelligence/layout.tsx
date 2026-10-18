import { requireAdminHeader } from '@/lib/auth/session'

// Access gate only — Country Intelligence is platform-admin only in v1 (every
// run spends money on Gemini). Middleware enforces the same rule.
export default function CountryIntelLayout({ children }: { children: React.ReactNode }) {
  requireAdminHeader()
  return <>{children}</>
}
