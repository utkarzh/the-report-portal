export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { listMediaOptions } from '@/lib/media-library-server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import PresentationCreateForm from '@/components/commercial-presentations/PresentationCreateForm'
import { MODULE_PATH } from '@/lib/commercial-presentations'
import { agenciesHref } from '@/lib/agencies'

export default async function NewCommercialPresentationPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const [{ data: agencies }, media, { data: scripts }] = await Promise.all([
    supabaseAdmin.from('agencies').select('id, name, active').order('sort_order').order('name'),
    listMediaOptions(),
    supabaseAdmin.from('presentation_master_content').select('ref_id').eq('kind', 'media'),
  ])
  // Only active agencies can be picked; inactive ones are kept for past work.
  const allAgencies = agencies || []
  const activeAgencies = allAgencies.filter((a) => a.active).map(({ id, name }) => ({ id, name }))
  const isAdmin = profile.role === 'admin'
  const withScript = new Set((scripts || []).map((s) => s.ref_id))
  const missingScripts: Record<string, string> = {}
  for (const m of media) {
    if (!withScript.has(m.id)) missingScripts[m.id] = 'No approved presentation script for this media yet — an admin must add one before the presentation can be submitted.'
  }

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-4xl">
        <Breadcrumbs items={[{ label: 'Commercial Presentations', href: MODULE_PATH }, { label: 'New' }]} />
        <h1 className="mb-6 text-lg font-semibold text-gray-900">New commercial presentation</h1>
        {activeAgencies.length === 0 ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3.5">
            <p className="text-sm text-red-800">
              <span className="font-semibold">
                {allAgencies.length === 0 ? 'No agencies have been added yet.' : 'All agencies are inactive.'}
              </span>{' '}
              {isAdmin
                ? allAgencies.length === 0
                  ? 'Add an agency before creating a presentation.'
                  : 'Activate an agency (or add one) before creating a presentation.'
                : 'Ask an admin to add or activate an agency under Admin → Agencies.'}
            </p>
            {isAdmin && (
              <Link
                href={agenciesHref('commercial-presentations')}
                className="flex-shrink-0 bg-black px-4 py-2 text-xs font-medium uppercase tracking-wider text-white transition-colors hover:bg-gray-900"
              >
                Manage agencies
              </Link>
            )}
          </div>
        ) : (
          <PresentationCreateForm agencies={activeAgencies} media={media} missingScripts={missingScripts} />
        )}
      </div>
    </div>
  )
}
