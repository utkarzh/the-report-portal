'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, X, ArrowLeft, FolderKanban, LayoutGrid, ClipboardCheck, ArrowLeftRight, BarChart3 } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import MobileTopBar from '@/components/layout/MobileTopBar'
import { useMediaQuery, useMobileDrawer } from '@/lib/use-mobile'
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
  const drawer = useMobileDrawer()
  // One bell at a time: in the top bar on phones (the drawer is shut most of
  // the time), in the sidebar on desktop. Each one fetches notifications.
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-screen lg:min-h-0 lg:flex-row lg:overflow-hidden">
      <MobileTopBar onOpenMenu={drawer.openDrawer} menuOpen={drawer.open} homeHref={navItems[0]?.href}>
        {isDesktop === false && <NotificationBell placement="topbar" />}
      </MobileTopBar>

      {drawer.open && (
        <div className="modal-backdrop-in fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={drawer.close} />
      )}

      <aside
        className={[
          'bg-black border-r border-gray-800 flex flex-col flex-shrink-0 lg:h-full w-72 max-w-[85vw] lg:w-64 lg:max-w-none',
          'transition-[transform,visibility] duration-300 ease-in-out',
          'fixed inset-y-0 left-0 z-50',
          drawer.open ? 'translate-x-0' : '-translate-x-full max-lg:invisible',
          'lg:visible lg:relative lg:translate-x-0 lg:z-auto',
        ].join(' ')}
      >
        <div className="flex items-center justify-between h-14 lg:h-16 border-b border-gray-800 pl-4 pr-1.5 lg:px-4">
          <Image
            src="/logo.png"
            alt="The Report Company"
            height={44}
            width={222}
            priority
            unoptimized
            className="h-auto w-40 flex-shrink-0"
          />
          <button
            onClick={drawer.close}
            aria-label="Close menu"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:text-white lg:hidden"
          >
            <X size={20} />
          </button>
        </div>

        <nav
          className="flex-1 px-3 py-4 overflow-y-auto overscroll-contain"
          onClick={(e) => { if ((e.target as Element).closest('a')) drawer.close() }}
        >
          <Link
            href={backHref}
            className="flex items-center gap-2.5 px-3 py-3 lg:py-2 rounded text-xs text-gray-500 hover:text-white hover:bg-white/5 mb-3 transition-colors"
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
                className={`flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded text-sm mb-0.5 transition-colors ${
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
              {isDesktop && <NotificationBell />}
              <button onClick={handleSignOut} title="Sign out" aria-label="Sign out" className="-mr-2.5 p-2.5 lg:can-hover:mr-0 lg:can-hover:p-0 text-gray-500 hover:text-white transition-colors">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-clip bg-[#f0efec] lg:overflow-x-auto lg:overflow-y-auto">{children}</main>
    </div>
  )
}
