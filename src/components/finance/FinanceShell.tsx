'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Menu, LogOut, ArrowLeft, FolderKanban, LayoutGrid, ClipboardCheck, ArrowLeftRight, BarChart3 } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import NotificationBell from './NotificationBell'

// Icons are resolved here, inside the client boundary, from a plain string
// key — the parent layouts are Server Components, and a React component
// (a function) can't be passed as a prop from server to client, only plain
// serializable data. Add new nav icons here as they're needed.
const ICONS: Record<string, React.ElementType> = {
  'folder-kanban': FolderKanban,
  'layout-grid': LayoutGrid,
  'clipboard-check': ClipboardCheck,
  'arrow-left-right': ArrowLeftRight,
  'bar-chart-3': BarChart3,
}

interface NavItem {
  label: string
  href: string
  icon: keyof typeof ICONS
  badge?: number
}

interface Props {
  navItems: NavItem[]
  personaLabel: string
  userName: string | null
  // Shown at the top of the nav so a Finance Admin can get back to editorial,
  // and a field user can see they're in a distinct module — mirrors the
  // brief's "one login, one tool" feel (A-03) without merging the two navs.
  backHref?: string
  children: React.ReactNode
}

export default function FinanceShell({ navItems, personaLabel, userName, backHref = '/dashboard', children }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [pathname])

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
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
            href={backHref}
            className="flex items-center gap-2.5 px-3 py-2 rounded text-xs text-gray-500 hover:text-white hover:bg-white/5 mb-3 transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">
            Finance
          </p>
          {navItems.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = ICONS[item.icon]
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
                {!!item.badge && (
                  <span className="bg-red-600 text-white text-[10px] font-semibold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-gray-800 pt-4 pb-5 px-5">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">{userName || 'User'}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">{personaLabel}</p>
            </div>
            <div className="flex items-center gap-3 ml-3 flex-shrink-0">
              <NotificationBell />
              <button onClick={handleSignOut} title="Sign out" className="text-gray-500 hover:text-white transition-colors">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[#f0efec]">{children}</main>
    </div>
  )
}
