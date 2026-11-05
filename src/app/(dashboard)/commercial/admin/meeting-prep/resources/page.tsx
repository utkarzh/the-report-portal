export const dynamic = 'force-dynamic'

import Breadcrumbs from '@/components/layout/Breadcrumbs'
import PlanteoResourcesManager, { type SlotState } from '@/components/admin/PlanteoResourcesManager'
import { MEETING_PREP_RESOURCE_SLOTS } from '@/lib/meeting-prep'
import { getResourceFile } from '@/lib/meeting-prep-server'

// Admin → Meeting Preparation → Apertura sample files: the sample apertura
// letter and company list format the aperturador script links to, provided
// by the client. Admin-only via layout.tsx.
export default async function PlanteoResourcesPage() {
  const initial: SlotState[] = await Promise.all(
    MEETING_PREP_RESOURCE_SLOTS.map(async (def) => {
      const file = await getResourceFile(def.slot)
      return {
        slot: def.slot,
        name: file?.name ?? null,
        size: file?.size ?? null,
        updatedAt: file?.updatedAt ?? null,
      }
    }),
  )

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Meeting Preparation', href: '/commercial/meeting-preparation' },
            { label: 'Admin', href: '/commercial/admin/meeting-prep' },
            { label: 'Apertura sample files' },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Apertura sample files</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The sample apertura letter and the sample company apertura list format that the Minister / Head of
            Industry Association planteo links to. Until a file is uploaded, its link shows as not available.
          </p>
        </div>
        <PlanteoResourcesManager initial={initial} />
      </div>
    </div>
  )
}
