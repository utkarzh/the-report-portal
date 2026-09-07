import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import SalesCoachForm from '@/components/sales-coach/SalesCoachForm'

export default function NewNegotiationPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="mx-auto max-w-3xl">
        <Breadcrumbs items={[{ label: 'Sales Coach', href: '/sales-coach' }, { label: 'New negotiation' }]} />
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">New negotiation</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
            Add the context, upload the recording (or paste a transcript), and declare the outcome. The coach transcribes it and produces your Report Card.
          </p>
        </div>
        <SalesCoachForm userId={profile.id} />
      </div>
    </div>
  )
}
