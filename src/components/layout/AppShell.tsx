'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import type { UserRole } from '@/types'

interface Props {
  children: React.ReactNode
  role: UserRole
  tokenUsed: number
  tokenLimit: number
  userName: string | null
  canAccessInterview: boolean
  canAccessTranscriptions: boolean
}

export default function AppShell({ children, role, tokenUsed, tokenLimit, userName, canAccessInterview, canAccessTranscriptions }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  // Close drawer whenever the user navigates
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile menu button — replaces the old top bar's hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="lg:hidden fixed top-3 left-3 z-30 p-2 rounded bg-black text-gray-300 hover:text-white shadow-lg"
      >
        <Menu size={20} />
      </button>

      {/* Backdrop — mobile only */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        role={role}
        tokenUsed={tokenUsed}
        tokenLimit={tokenLimit}
        userName={userName}
        canAccessInterview={canAccessInterview}
        canAccessTranscriptions={canAccessTranscriptions}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <main className="flex-1 overflow-y-auto bg-[#f0efec]">
        {children}
      </main>
    </div>
  )
}
