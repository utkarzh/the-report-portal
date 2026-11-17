export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import AgencyProfileEditor from '@/components/commercial-presentations/admin/AgencyProfileEditor'
import { ADMIN_PATH, MODULE_PATH } from '@/lib/commercial-presentations'
import { loadMasterRow } from '@/lib/commercial-presentations-server'

export default async function PresentationAgencyWordingPage({ params }: { params: { id: string } }) {
  requireAdminHeader()
  const { data: agency } = await supabaseAdmin.from('agencies').select('id, name').eq('id', params.id).maybeSingle()
  if (!agency) notFound()
  const row = await loadMasterRow('agency', agency.id)
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs
          items={[
            { label: 'Commercial Presentations', href: MODULE_PATH },
            { label: 'Admin', href: ADMIN_PATH },
            { label: 'Agency profiles', href: `${ADMIN_PATH}/agencies` },
            { label: agency.name },
          ]}
        />
        <h1 className="mb-6 text-lg font-semibold text-gray-900">{agency.name} — Agency profile</h1>
        <AgencyProfileEditor agencyId={agency.id} agencyName={agency.name} initialRow={row} />
      </div>
    </div>
  )
}
