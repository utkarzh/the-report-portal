import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          role={profile.role}
          tokenUsed={profile.tokens_used}
          tokenLimit={profile.token_limit}
          userName={profile.full_name}
        />
        <main className="flex-1 overflow-y-auto bg-[#f0efec]">
          {children}
        </main>
      </div>
    </div>
  )
}
