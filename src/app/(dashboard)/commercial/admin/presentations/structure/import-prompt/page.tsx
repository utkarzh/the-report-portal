export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import StructureImportPromptEditor from '@/components/commercial-presentations/admin/StructureImportPromptEditor'
import { ADMIN_PATH, MODULE_PATH } from '@/lib/commercial-presentations'
import { loadMasterRow } from '@/lib/commercial-presentations-server'

export default async function StructureImportPromptPage() {
  requireAdminHeader()
  // Before migration 050 the row can't exist; the editor then shows the default.
  const row = await loadMasterRow('structure_import_prompt', null).catch(() => null)
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs
          items={[
            { label: 'Commercial Presentations', href: MODULE_PATH },
            { label: 'Admin', href: ADMIN_PATH },
            { label: 'Structure & locked methodology', href: `${ADMIN_PATH}/structure` },
            { label: 'Reading instructions' },
          ]}
        />
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">Reading instructions for “Build from a document”</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
            Test a change by uploading a couple of different documents (a labelled script and plain paragraphs) before relying on it. Changing these
            instructions never changes the saved structure or any presentation; it only affects the next upload.
          </p>
        </div>
        <StructureImportPromptEditor initialRow={row} />
      </div>
    </div>
  )
}
