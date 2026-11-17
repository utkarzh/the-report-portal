export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import WhyNowPromptEditor from '@/components/commercial-presentations/admin/WhyNowPromptEditor'
import { ADMIN_PATH, MODULE_PATH } from '@/lib/commercial-presentations'
import { loadMasterRow } from '@/lib/commercial-presentations-server'

export default async function PresentationWhyNowPromptPage() {
  requireAdminHeader()
  const row = await loadMasterRow('why_now_prompt', null)
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs items={[{ label: 'Commercial Presentations', href: MODULE_PATH }, { label: 'Admin', href: ADMIN_PATH }, { label: 'Why Now prompt' }]} />
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">Why [Country] Now prompt</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
            Test changes against several different projects before relying on them — including one with no obvious anchor event (brief §29). Changing the prompt never alters an approved presentation.
          </p>
        </div>
        <WhyNowPromptEditor initialRow={row} />
      </div>
    </div>
  )
}
