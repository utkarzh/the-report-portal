export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import StatusPill from '@/components/ui/StatusPill'
import { ADMIN_PATH, MODULE_PATH, mediaMarketFromCountry, sectionsHaveContent, validateMediaContent } from '@/lib/commercial-presentations'
import { listMediaOptions } from '@/lib/media-library-server'
import { mediaLibraryHref } from '@/lib/media-library'

export default async function PresentationMediaScriptsPage() {
  requireAdminHeader()
  const [media, { data: rows }] = await Promise.all([
    listMediaOptions(),
    supabaseAdmin.from('presentation_master_content').select('ref_id, content, version_label').eq('kind', 'media').eq('language', 'en'),
  ])
  const byMedia = new Map((rows || []).map((r) => [r.ref_id as string, r]))

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs items={[{ label: 'Commercial Presentations', href: MODULE_PATH }, { label: 'Admin', href: ADMIN_PATH }, { label: 'Media scripts' }]} />
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">Media scripts</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
            A presentation can only be submitted once its media has a script. To add a publication, use the{' '}
            <Link href={mediaLibraryHref('commercial-presentations')} className="underline">
              Media Library
            </Link>
            .
          </p>
        </div>
        <ul className="divide-y divide-[#efede9] border border-[#e5e3df] bg-white">
          {media.map((m) => {
            const row = byMedia.get(m.id)
            const content = row ? validateMediaContent(row.content) : null
            const ready = sectionsHaveContent(content?.sections)
            return (
              <li key={m.id}>
                <Link href={`${ADMIN_PATH}/media/${m.id}`} className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-gray-50">
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-800">{m.name}</span>
                    <span className="block text-xs text-gray-400">
                      {content?.mediaMarket || m.country ? `Media Market: ${content?.mediaMarket || mediaMarketFromCountry(m.country)}` : 'No Media Market set'}
                      {row ? ` · v${row.version_label}` : ''}
                    </span>
                  </span>
                  <StatusPill label={ready ? `${content!.sections.length} ${content!.sections.length === 1 ? 'section' : 'sections'}` : 'No script'} tone={ready ? 'emerald' : 'amber'} />
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
