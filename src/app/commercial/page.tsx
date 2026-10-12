import Link from 'next/link'
import { Briefcase, CalendarClock, Handshake, ArrowRight } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { canAccessBusinessCases, canAccessMeetingPreparation, canAccessSalesNegotiationCoach } from '@/lib/access'

// Landing page for the Commercial domain — the "Commercial Tools" doorway
// link in the main Sidebar points here. Simple cards, only for the modules
// this user can actually reach; CommercialShell's own nav (plus its Admin
// section) handles the rest of the navigation once inside.
export default function CommercialHubPage() {
  const profile = getProfileFromHeaders()
  if (!profile) return null

  const cards = [
    canAccessBusinessCases(profile) && {
      href: '/commercial/business-cases',
      icon: Briefcase,
      label: 'Business Cases',
      description: 'A snapshot of a country and its economy to assess whether it is worth pursuing.',
    },
    canAccessMeetingPreparation(profile) && {
      href: '/commercial/meeting-preparation',
      icon: CalendarClock,
      label: 'Meeting Preparation',
      description: 'Prepare for sales meetings — company analysis, presentation points, and a suggested planteo.',
    },
    canAccessSalesNegotiationCoach(profile) && {
      href: '/commercial/sales-coach',
      icon: Handshake,
      label: 'Sales Coach',
      description: 'Analyse a sales meeting recording and get a score, feedback, and recommendations.',
    },
  ].filter((c): c is { href: string; icon: typeof Briefcase; label: string; description: string } => Boolean(c))

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-base font-semibold text-gray-900">Commercial</h1>
        <p className="mt-1 text-sm text-gray-500">Tools that support sales meetings and commercial decisions.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ href, icon: Icon, label, description }) => (
          <Link
            key={href}
            href={href}
            className="group block rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-400"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="rounded-lg border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700">
                <Icon size={18} />
              </div>
              <ArrowRight size={15} className="mt-1 text-gray-300 transition-colors group-hover:text-gray-600" />
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-900">{label}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
