export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import ScriptEditor from '@/components/commercial-presentations/admin/ScriptEditor'
import { ADMIN_PATH, MODULE_PATH } from '@/lib/commercial-presentations'
import { loadMasterRow } from '@/lib/commercial-presentations-server'

export default async function PresentationMediaScriptPage({ params }: { params: { mediaId: string } }) {
  requireAdminHeader()
  const { data: media } = await supabaseAdmin.from('media_library').select('id, name, country').eq('id', params.mediaId).maybeSingle()
  if (!media) notFound()
  const row = await loadMasterRow('media', media.id)
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs
          items={[
            { label: 'Commercial Presentations', href: MODULE_PATH },
            { label: 'Admin', href: ADMIN_PATH },
            { label: 'Media scripts', href: `${ADMIN_PATH}/media` },
            { label: media.name },
          ]}
        />
        <h1 className="mb-6 text-lg font-semibold text-gray-900">{media.name}</h1>
        <ScriptEditor refId={media.id} entityName={media.name} libraryCountry={media.country || ''} initialRow={row} />
      </div>
    </div>
  )
}
