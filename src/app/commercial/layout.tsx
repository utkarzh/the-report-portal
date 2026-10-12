import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { canAccessBusinessCases, canAccessMeetingPreparation, canAccessSalesNegotiationCoach } from '@/lib/access'
import CommercialShell from '@/components/commercial/CommercialShell'

// The Commercial domain — Business Cases, Meeting Preparation, and Sales
// Coach, moved out of the main editorial app into their own standalone
// section (mirrors how Finance/Caja Tool is its own domain, not woven into
// the main Sidebar). One shell for everyone in the domain (unlike Finance's
// field/admin split, these 3 modules don't have a separate persona system —
// admins just also see an Admin section in the same nav).
export default function CommercialLayout({ children }: { children: React.ReactNode }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const canBusinessCases = canAccessBusinessCases(profile)
  const canMeetingPrep = canAccessMeetingPreparation(profile)
  const canSalesCoach = canAccessSalesNegotiationCoach(profile)
  if (!canBusinessCases && !canMeetingPrep && !canSalesCoach) redirect('/dashboard')

  return (
    <CommercialShell
      userName={profile.full_name}
      isAdmin={profile.role === 'admin'}
      canAccessBusinessCases={canBusinessCases}
      canAccessMeetingPreparation={canMeetingPrep}
      canAccessSalesNegotiationCoach={canSalesCoach}
    >
      {children}
    </CommercialShell>
  )
}
