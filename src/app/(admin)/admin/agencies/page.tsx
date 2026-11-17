export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import AgencyManager from '@/components/admin/AgencyManager'
import { AGENCY_ORIGINS, parseAgencyOrigin } from '@/lib/agencies'
import { listAgencies } from '@/lib/agencies-server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Props {
  searchParams: { from?: string | string[] }
}

// The one agency list every tool uses (migration 047), like the Media
// Library is for publications. Opened from each module's admin area.
export default async function AgenciesPage({ searchParams }: Props) {
  requireAdminHeader()
  const from = parseAgencyOrigin(searchParams.from)
  // Before 047 the list falls back to the built-in TRC/GFDI pair, which
  // can't be edited — say so instead of offering broken controls.
  const { error } = await supabaseAdmin.from('agencies').select('code').limit(1)
  const agencies = await listAgencies()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="max-w-4xl mx-auto">
        {from && <Breadcrumbs items={[...AGENCY_ORIGINS[from], { label: 'Agencies' }]} />}
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Agencies</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The one list of agencies every tool uses: Interview Letters (company, templates, prompts, samples, branded
            exports) and Commercial Presentations. Each tool stores the agency&apos;s code, so renaming an agency never
            changes past work, and an agency in use can be deactivated but not deleted.
          </p>
          <p className="text-xs text-gray-400 mt-2 max-w-2xl">
            A new agency needs its own Interview Letter templates and prompts (Interview Letters → Admin) before letters
            can be generated for it.
          </p>
        </div>
        {error ? (
          <p className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            The central agency list isn&apos;t set up on this database yet — run supabase/migrations/046_commercial_presentations.sql
            and 047_central_agencies.sql. Until then every tool keeps using The Report Company (TRC) and Global FDI Reports (GFDI).
          </p>
        ) : (
          <AgencyManager initialAgencies={agencies} />
        )}
      </div>
    </div>
  )
}
