export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import MediaLibraryEntryForm from '@/components/admin/MediaLibraryEntryForm'
import { MEDIA_LIBRARY_ORIGINS, mediaLibraryHref, parseMediaLibraryOrigin } from '@/lib/media-library'
import type { MediaLibraryEntry } from '@/types'

interface Props {
  params: { id: string }
  searchParams: { from?: string | string[] }
}

export default async function MediaLibraryEntryPage({ params, searchParams }: Props) {
  requireAdminHeader()
  const from = parseMediaLibraryOrigin(searchParams.from)

  const [{ data: entry }, { data: guides }] = await Promise.all([
    supabaseAdmin.from('media_library').select('*').eq('id', params.id).maybeSingle(),
    supabaseAdmin
      .from('copywriting_publication_guides')
      .select('id, filename, char_count, truncated, created_at')
      .eq('publication_id', params.id)
      .order('created_at'),
  ])
  if (!entry) notFound()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-3xl mx-auto">
        <Breadcrumbs
          items={[
            ...(from ? MEDIA_LIBRARY_ORIGINS[from] : []),
            { label: 'Media Library', href: mediaLibraryHref(from) },
            { label: entry.name },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">{entry.name}</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The name and country appear in every tool&apos;s publication list. The sections below are only used by the
            tool they&apos;re named after; leave any of them empty if that tool doesn&apos;t work with this publication.
          </p>
        </div>

        <MediaLibraryEntryForm entry={entry as MediaLibraryEntry} initialGuides={guides || []} from={from} />
      </div>
    </div>
  )
}
