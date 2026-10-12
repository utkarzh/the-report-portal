'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Menu, LogOut, ArrowLeft, Briefcase, CalendarClock, Handshake, Settings2 } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

interface Props {
  userName: string | null
  isAdmin: boolean
  canAccessBusinessCases: boolean
  canAccessMeetingPreparation: boolean
  canAccessSalesNegotiationCoach: boolean
  children: React.ReactNode
}

// Standalone shell for the Commercial domain (Business Cases, Meeting
// Preparation, Sales Coach) — sibling to FinanceShell, not a shared
// abstraction with it: Finance splits field vs admin into two personas with
// different nav, these 3 modules don't (everyone sees the same module list;
// admins additionally see an Admin section below it), so the shapes differ
// enough that forcing one component would just add conditionals.
export default function CommercialShell({
  userName,
  isAdmin,
  canAccessBusinessCases,
  canAccessMeetingPreparation,
  canAccessSalesNegotiationCoach,
  children,
}: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [pathname])

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navItems: NavItem[] = [
    ...(canAccessBusinessCases ? [{ label: 'Business Cases', href: '/commercial/business-cases', icon: Briefcase }] : []),
    ...(canAccessMeetingPreparation ? [{ label: 'Meeting Preparation', href: '/commercial/meeting-preparation', icon: CalendarClock }] : []),
    ...(canAccessSalesNegotiationCoach ? [{ label: 'Sales Coach', href: '/commercial/sales-coach', icon: Handshake }] : []),
  ]

  const adminItems: NavItem[] = [
    { label: 'Meeting Prep Admin', href: '/commercial/admin/meeting-prep', icon: Settings2 },
    { label: 'Sales Coach Admin', href: '/commercial/admin/sales-coach', icon: Settings2 },
  ]

  function renderLink(item: NavItem) {
    const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
    const Icon = item.icon
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm mb-0.5 transition-colors ${
          isActive ? 'bg-white/10 text-white font-medium' : 'text-gray-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        <Icon size={16} className="flex-shrink-0" />
        <span className="flex-1">{item.label}</span>
      </Link>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="lg:hidden fixed top-3 left-3 z-30 p-2 rounded bg-black text-gray-300 hover:text-white shadow-lg"
      >
        <Menu size={20} />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={[
          'bg-black border-r border-gray-800 flex flex-col flex-shrink-0 h-full w-64',
          'transition-transform duration-300 ease-in-out',
          'fixed inset-y-0 left-0 z-50',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:relative lg:translate-x-0 lg:z-auto',
        ].join(' ')}
      >
        <div className="flex items-center h-16 border-b border-gray-800 px-4">
          <Image
            src="/logo.png"
            alt="The Report Company"
            height={44}
            width={222}
            priority
            unoptimized
            className="h-auto w-40 flex-shrink-0"
          />
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 px-3 py-2 rounded text-xs text-gray-500 hover:text-white hover:bg-white/5 mb-3 transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">
            Commercial
          </p>
          {navItems.map(renderLink)}

          {isAdmin && (
            <>
              <div className="mt-4 pt-4 border-t border-gray-800 mb-2">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Admin
                </p>
              </div>
              {adminItems.map(renderLink)}
            </>
          )}
        </nav>

        <div className="border-t border-gray-800 pt-4 pb-5 px-5">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">{userName || 'User'}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Commercial</p>
            </div>
            <button onClick={handleSignOut} title="Sign out" className="text-gray-500 hover:text-white transition-colors flex-shrink-0 ml-3">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[#f0efec]">{children}</main>
    </div>
  )
}
