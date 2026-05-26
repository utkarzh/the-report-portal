'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  PlusSquare,
  Clock,
  Users,
  Tag,
  FileText,
  BarChart2,
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
}

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

const toolNavItems: NavItem[] = [
  { label: 'New Interview', href: '/research', icon: PlusSquare },
  { label: 'History', href: '/history', icon: Clock },
]

const managementNavItems: NavItem[] = [
  { label: 'Users', href: '/admin/users', icon: Users },
  { label: 'Categories', href: '/admin/categories', icon: Tag },
  { label: 'Prompts', href: '/admin/prompts', icon: FileText },
  { label: 'Analytics', href: '/admin/analytics', icon: BarChart2 },
]

function NavLink({ item, collapsed, pathname }: { item: NavItem; collapsed: boolean; pathname: string }) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm mb-0.5 transition-colors ${
        collapsed ? 'justify-center' : ''
      } ${
        isActive
          ? 'bg-black text-white font-medium'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
    >
      <Icon size={16} className="flex-shrink-0" />
      {!collapsed && item.label}
    </Link>
  )
}

export default function Sidebar({ role, tokenUsed, tokenLimit, userName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)

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
      className={`${collapsed ? 'w-16' : 'w-72'} bg-white border-r border-[#e5e3df] flex flex-col flex-shrink-0 h-full transition-all duration-200`}
    >
      <div className={`flex items-center ${collapsed ? 'justify-center px-3' : 'justify-end px-4'} pt-4 pb-2`}>
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
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
            <div className="mt-4 pt-4 border-t border-[#e5e3df] mb-2">
              {!collapsed && (
                <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  Management
                </p>
              )}
            </div>
            {managementNavItems.map((item) => (
              <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
            ))}
          </>
        )}
      </nav>

      <div className={`pb-5 border-t border-[#e5e3df] pt-4 ${collapsed ? 'px-3' : 'px-5'}`}>
        {role === 'user' && !collapsed && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>Token usage</span>
              <span className={isNearLimit ? 'text-orange-500 font-medium' : ''}>
                {formatTokens(tokenUsed)} / {formatTokens(tokenLimit)}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-orange-400' : 'bg-black'
                }`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            {isAtLimit && (
              <p className="text-xs text-red-500 mt-1.5">Token limit reached</p>
            )}
          </div>
        )}

        {collapsed ? (
          <div className="flex flex-col items-center gap-3">
            <div
              title={userName || 'User'}
              className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 flex-shrink-0"
            >
              {(userName || 'U')[0].toUpperCase()}
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="text-gray-400 hover:text-gray-700 transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">
                {userName || 'User'}
              </p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">
                {role}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="text-gray-400 hover:text-gray-700 transition-colors ml-3 flex-shrink-0"
            >
              <LogOut size={15} />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
