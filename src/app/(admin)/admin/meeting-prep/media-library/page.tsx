export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import DeleteMediaLibraryButton from '@/components/admin/DeleteMediaLibraryButton'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import type { MeetingPrepMediaLibraryEntry } from '@/types'

export default async function MediaLibraryPage() {
  requireAdminHeader()

  const { data: entries } = await supabaseAdmin
    .from('meeting_prep_media_library')
    .select('*')
    .order('publication_name', { ascending: true })

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">

        <Breadcrumbs
          items={[
            { label: 'Meeting Preparation', href: '/meeting-preparation' },
            { label: 'Admin', href: '/admin/meeting-prep' },
            { label: 'Media Library' },
          ]}
        />

        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Media Library</h1>
            <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
              One profile per TRC publication. A publication with no profile here halts the workflow at Step 1.
            </p>
          </div>
          <Link
            href="/admin/meeting-prep/media-library/new"
            className="inline-flex items-center gap-2 bg-black text-white px-4 py-2.5 text-xs font-medium tracking-wider uppercase hover:bg-gray-900 transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Publication
          </Link>
        </div>

        {(!entries || entries.length === 0) ? (
          <div className="bg-white border border-[#e5e3df] p-10 text-center">
            <p className="text-sm text-gray-400">No publications yet. Add one to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(entries as MeetingPrepMediaLibraryEntry[]).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between p-4 sm:p-5 bg-white border border-[#e5e3df]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{entry.publication_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{entry.country_of_publication}</p>
                </div>
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  <Link
                    href={`/admin/meeting-prep/media-library/${entry.id}`}
                    className="text-xs text-gray-500 hover:text-black transition-colors px-3 py-1.5 border border-[#e5e3df] hover:border-gray-400"
                  >
                    Edit
                  </Link>
                  <DeleteMediaLibraryButton entryId={entry.id} publicationName={entry.publication_name} />
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
