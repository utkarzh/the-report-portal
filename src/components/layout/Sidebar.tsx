'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  MessagesSquare,
  AudioLines,
  Users,
  BarChart3,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from 'lucide-react'
import type { UserRole } from '@/types'

interface SidebarProps {
  role: UserRole
  tokenUsed: number
  tokenLimit: number
  userName: string | null
  canAccessInterview: boolean
  canAccessTranscriptions: boolean
  mobileOpen?: boolean
  onMobileClose?: () => void
}

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

function NavLink({ item, collapsed, pathname }: { item: NavItem; collapsed: boolean; pathname: string }) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm mb-0.5 transition-colors ${
        collapsed ? 'lg:justify-center' : ''
      } ${
        isActive
          ? 'bg-white/10 text-white font-medium'
          : 'text-gray-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon size={16} className="flex-shrink-0" />
      <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
    </Link>
  )
}

export default function Sidebar({ role, tokenUsed, tokenLimit, userName, canAccessInterview, canAccessTranscriptions, mobileOpen = false }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)

  // Only show modules this user can access (admins have all).
  const toolNavItems: NavItem[] = [
    ...(canAccessInterview ? [{ label: 'Interview Tool', href: '/interview', icon: MessagesSquare }] : []),
    ...(canAccessTranscriptions ? [{ label: 'Transcriptions', href: '/transcriptions', icon: AudioLines }] : []),
  ]

  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed')
    if (stored !== null) setCollapsed(stored === 'true')
  }, [])

  function toggleCollapsed() {
    setCollapsed(prev => {
      localStorage.setItem('sidebar-collapsed', String(!prev))
      return !prev
    })
  }

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const usagePercent = Math.min((tokenUsed / tokenLimit) * 100, 100)
  const isNearLimit = usagePercent >= 80
  const isAtLimit = usagePercent >= 100

  return (
    <aside
      className={[
        // Always
        'bg-black border-r border-gray-800 flex flex-col flex-shrink-0 h-full',
        'transition-transform duration-300 ease-in-out',
        // Mobile: fixed full-height drawer, slides in/out
        'fixed inset-y-0 left-0 z-50 w-64',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        // Desktop: back in normal flow, width driven by collapsed state
        'lg:relative lg:translate-x-0 lg:z-auto',
        collapsed ? 'lg:w-16' : 'lg:w-64',
      ].join(' ')}
    >
      {/* Logo + collapse toggle */}
      <div className={`flex items-center h-16 border-b border-gray-800 ${collapsed ? 'lg:justify-center lg:px-2' : 'justify-between pl-4 pr-2'}`}>
        {!collapsed && (
          <Image
            src="/logo.png"
            alt="The Report Company"
            height={44}
            width={222}
            priority
            unoptimized
            className="h-auto w-32 flex-shrink-0"
          />
        )}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden lg:block p-1.5 rounded text-gray-600 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 px-3 overflow-y-auto">
        {toolNavItems.map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
        ))}

        {role === 'admin' && (
          <>
            <div className="mt-4 pt-4 border-t border-gray-800 mb-2">
              <p className={`px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-500 ${collapsed ? 'lg:hidden' : ''}`}>
                Admin
              </p>
            </div>
            <NavLink item={{ label: 'Users', href: '/admin/users', icon: Users }} collapsed={collapsed} pathname={pathname} />
            <NavLink item={{ label: 'Analytics', href: '/admin/analytics', icon: BarChart3 }} collapsed={collapsed} pathname={pathname} />
            <NavLink item={{ label: 'Audit Logs', href: '/admin/audit-logs', icon: ScrollText }} collapsed={collapsed} pathname={pathname} />
          </>
        )}
      </nav>

      <div className={`pb-5 border-t border-gray-800 pt-4 px-5 ${collapsed ? 'lg:px-3' : ''}`}>
        {role === 'user' && (
          <div className={`mb-4 ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Token usage</span>
              <span className={isNearLimit ? 'text-orange-400 font-medium' : ''}>
                {formatTokens(tokenUsed)} / {formatTokens(tokenLimit)}
              </span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-orange-400' : 'bg-white'
                }`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            {isAtLimit && (
              <p className="text-xs text-red-400 mt-1.5">Token limit reached</p>
            )}
          </div>
        )}

        {/* On mobile never collapsed — always show full user row */}
        {collapsed ? (
          <div className="hidden lg:flex flex-col items-center gap-3">
            <div
              title={userName || 'User'}
              className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-200 flex-shrink-0"
            >
              {(userName || 'U')[0].toUpperCase()}
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="text-gray-500 hover:text-white transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        ) : null}

        {/* Full user row — always on mobile, only when expanded on desktop */}
        <div className={collapsed ? 'lg:hidden' : ''}>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">
                {userName || 'User'}
              </p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">
                {role}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="text-gray-500 hover:text-white transition-colors ml-3 flex-shrink-0"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
