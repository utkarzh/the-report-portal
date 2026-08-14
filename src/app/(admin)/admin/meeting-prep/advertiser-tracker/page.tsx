export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import AdvertiserTrackerManager from '@/components/admin/AdvertiserTrackerManager'

export default async function AdvertiserTrackerPage() {
  requireAdminHeader()

  const { data } = await supabaseAdmin
    .from('meeting_prep_advertiser_tracker')
    .select('id, country, filename, row_count, updated_at')
    .order('country', { ascending: true })

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Meeting Preparation', href: '/meeting-preparation' },
            { label: 'Admin', href: '/admin/meeting-prep' },
            { label: 'Advertiser Tracker' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Advertiser Tracker</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            One tracker spreadsheet per country. When a meeting-prep session runs, the interviewee&apos;s company
            is matched against the tracker for its country to auto-fill the Commercial Alert (publication, ad
            space, year). Re-upload a country to apply the weekly update.
          </p>
        </div>

        <AdvertiserTrackerManager initial={data || []} />
      </div>
    </div>
  )
}
