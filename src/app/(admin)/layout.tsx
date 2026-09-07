import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { canAccessFinance, isFinanceAdmin } from '@/lib/access'
import AppShell from '@/components/layout/AppShell'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  return (
    <AppShell
      role={profile.role}
      tokenUsed={profile.tokens_used}
      tokenLimit={profile.token_limit}
      userName={profile.full_name}
      canAccessInterview={profile.can_access_interview}
      canAccessTranscriptions={profile.can_access_transcriptions}
      canAccessBusinessCases={profile.can_access_business_cases}
      canAccessEditorialBriefs={profile.can_access_editorial_briefs}
      canAccessMeetingPreparation={profile.can_access_meeting_preparation}
      canAccessInterviewLetterGenerator={profile.can_access_interview_letter_generator}
      canAccessSalesNegotiationCoach={profile.can_access_sales_negotiation_coach}
      canAccessFinance={canAccessFinance(profile)}
      financeHref={isFinanceAdmin(profile) ? '/finance/admin' : '/finance'}
    >
      {children}
    </AppShell>
  )
}
