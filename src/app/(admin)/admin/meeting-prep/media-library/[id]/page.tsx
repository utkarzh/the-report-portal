export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import MediaLibraryForm from '@/components/admin/MediaLibraryForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import type { MeetingPrepMediaLibraryEntry } from '@/types'

interface Props {
  params: { id: string }
}

export default async function EditMediaLibraryEntryPage({ params }: Props) {
  requireAdminHeader()

  const { data: entry } = await supabaseAdmin
    .from('meeting_prep_media_library')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!entry) notFound()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">

        <Breadcrumbs
          items={[
            { label: 'Meeting Preparation', href: '/meeting-preparation' },
            { label: 'Admin', href: '/admin/meeting-prep' },
            { label: 'Media Library', href: '/admin/meeting-prep/media-library' },
            { label: 'Edit Publication' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Edit Publication</h1>
          <p className="text-sm text-gray-500 mt-1.5">{entry.publication_name}</p>
        </div>

        <MediaLibraryForm entry={entry as MeetingPrepMediaLibraryEntry} />

      </div>
    </div>
  )
}
