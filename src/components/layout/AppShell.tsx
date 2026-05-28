'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Header from './Header'
import Sidebar from './Sidebar'
import type { UserRole } from '@/types'

interface Props {
  children: React.ReactNode
  role: UserRole
  tokenUsed: number
  tokenLimit: number
  userName: string | null
}

export default function AppShell({ children, role, tokenUsed, tokenLimit, userName }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  // Close drawer whenever the user navigates
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header onMenuToggle={() => setMobileOpen(v => !v)} />

      <div className="flex flex-1 overflow-hidden">
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
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />

        <main className="flex-1 overflow-y-auto bg-[#f0efec]">
          {children}
        </main>
      </div>
    </div>
  )
}
