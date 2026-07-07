import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { landingPathFor } from '@/lib/access'

export default function DashboardPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  // No landing page — send users straight to their first accessible module
  // (interview tool by default; transcriptions or a no-access notice otherwise).
  redirect(landingPathFor(profile))
}
