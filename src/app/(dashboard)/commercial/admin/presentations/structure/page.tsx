export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import StructureEditor from '@/components/commercial-presentations/admin/StructureEditor'
import { ADMIN_PATH, MODULE_PATH } from '@/lib/commercial-presentations'
import { loadMasterRow } from '@/lib/commercial-presentations-server'

export default async function PresentationStructurePage() {
  requireAdminHeader()
  const row = await loadMasterRow('structure', null)
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs items={[{ label: 'Commercial Presentations', href: MODULE_PATH }, { label: 'Admin', href: ADMIN_PATH }, { label: 'Structure & methodology' }]} />
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">Structure &amp; locked methodology</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
            Normal users can never change this wording; it is assembled into every presentation exactly as written here. Variables in [BRACKETS] are filled in from the project.
          </p>
        </div>
        <StructureEditor initialRow={row} />
      </div>
    </div>
  )
}
