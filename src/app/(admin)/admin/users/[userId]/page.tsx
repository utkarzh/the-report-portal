import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminHeader, getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import EditUserForm from '@/components/admin/EditUserForm'
import type { Profile } from '@/types'

interface Props {
  params: { userId: string }
}

export default async function EditUserPage({ params }: Props) {
  requireAdminHeader()
  const adminProfile = getProfileFromHeaders()!

  const { data: user } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', params.userId)
    .single()

  if (!user) notFound()

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/admin/users" className="text-xs text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1 mb-4">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Users
        </Link>
        <h1 className="text-base font-semibold text-gray-900">Edit User</h1>
        <p className="text-xs text-gray-500 mt-1">{user.email}</p>
      </div>

      <div className="bg-white border border-[#e5e3df] p-6 max-w-md">
        <EditUserForm user={user as Profile} isSelf={adminProfile.id === user.id} />
      </div>
    </div>
  )
}
