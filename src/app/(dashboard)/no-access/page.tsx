import { redirect } from 'next/navigation'
import { Lock } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { landingPathFor } from '@/lib/access'

export default function NoAccessPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  // If the user actually has a module, don't strand them here.
  const landing = landingPathFor(profile)
  if (landing !== '/no-access') redirect(landing)

  return (
    <div className="p-8 flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#f7f6f3] text-gray-500">
          <Lock size={20} />
        </div>
        <h1 className="text-base font-semibold text-gray-900">No modules enabled</h1>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed">
          Your account doesn&apos;t have access to any tools yet. Please contact an
          administrator to have the interview tool or transcriptions enabled.
        </p>
      </div>
    </div>
  )
}
