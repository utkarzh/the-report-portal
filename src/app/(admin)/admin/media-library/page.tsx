export const dynamic = 'force-dynamic'

import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import MediaLibraryManager from '@/components/admin/MediaLibraryManager'
import { MEDIA_LIBRARY_ORIGINS, parseMediaLibraryOrigin } from '@/lib/media-library'
import type { MediaLibraryEntry } from '@/types'

interface Props {
  searchParams: { from?: string | string[] }
}

export default async function MediaLibraryPage({ searchParams }: Props) {
  requireAdminHeader()
  const from = parseMediaLibraryOrigin(searchParams.from)

  const [{ data: entries }, { data: guides }] = await Promise.all([
    supabaseAdmin.from('media_library').select('*').order('name'),
    supabaseAdmin.from('copywriting_publication_guides').select('publication_id'),
  ])
  const guideCounts: Record<string, number> = {}
  for (const g of guides || []) guideCounts[g.publication_id as string] = (guideCounts[g.publication_id as string] || 0) + 1

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-4xl mx-auto">
        {from && <Breadcrumbs items={[...MEDIA_LIBRARY_ORIGINS[from], { label: 'Media Library' }]} />}

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Media Library</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The one list of publications every tool picks its media partner from: Interviews, Transcriptions,
            Editorial Briefs, Business Cases, Interview Letters, Sales Coach, Meeting Preparation and the Copywriting
            Tool. Every tool uses the name and country; Meeting Preparation, Interview Letters and Copywriting also
            use the extra details you add on a publication&apos;s page.
          </p>
          <p className="text-xs text-gray-400 mt-2 max-w-2xl">
            Work already created keeps the publication name it was saved with, so renaming or deleting an entry
            never changes past documents.
          </p>
        </div>

        <MediaLibraryManager initialEntries={(entries || []) as MediaLibraryEntry[]} guideCounts={guideCounts} from={from} />
      </div>
    </div>
  )
}
