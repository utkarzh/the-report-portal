export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import ReferenceExamplesManager from '@/components/commercial-presentations/admin/ReferenceExamplesManager'
import { ADMIN_PATH, MODULE_PATH } from '@/lib/commercial-presentations'
import type { PresentationReferenceExample } from '@/types'

export default async function PresentationExamplesPage() {
  requireAdminHeader()
  const { data } = await supabaseAdmin.from('presentation_reference_examples').select('*').order('updated_at', { ascending: false })
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs items={[{ label: 'Commercial Presentations', href: MODULE_PATH }, { label: 'Admin', href: ADMIN_PATH }, { label: 'Reference examples' }]} />
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">Approved reference examples</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
            Pick strong examples across different project types — major events, bilateral relations, reforms, investment stories, strategic industries, and projects without an obvious anchor. The AI learns tone, rhythm and reasoning from them, and is told never to reuse their facts.
          </p>
        </div>
        <ReferenceExamplesManager initial={(data || []) as PresentationReferenceExample[]} />
      </div>
    </div>
  )
}
