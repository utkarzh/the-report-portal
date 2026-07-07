import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'

export default function DashboardPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  // No landing page — send users straight to the interview tool after login.
  redirect('/interview')
}
