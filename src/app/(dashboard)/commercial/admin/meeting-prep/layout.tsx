import { requireAdminHeader } from '@/lib/auth/session'

// Access gate only — platform admin required for every Meeting Prep config page.
export default function MeetingPrepAdminLayout({ children }: { children: React.ReactNode }) {
  requireAdminHeader()
  return <>{children}</>
}
