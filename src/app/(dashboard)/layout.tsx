import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import AppShell from '@/components/layout/AppShell'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  return (
    <AppShell
      role={profile.role}
      tokenUsed={profile.tokens_used}
      tokenLimit={profile.token_limit}
      userName={profile.full_name}
      canAccessInterview={profile.can_access_interview}
      canAccessTranscriptions={profile.can_access_transcriptions}
    >
      {children}
    </AppShell>
  )
}
