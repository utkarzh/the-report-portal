import { requireAdminHeader } from '@/lib/auth/session'
import MediaLibraryForm from '@/components/admin/MediaLibraryForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

export default function NewMediaLibraryEntryPage() {
  requireAdminHeader()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">

        <Breadcrumbs
          items={[
            { label: 'Meeting Preparation', href: '/meeting-preparation' },
            { label: 'Admin', href: '/admin/meeting-prep' },
            { label: 'Media Library', href: '/admin/meeting-prep/media-library' },
            { label: 'New Publication' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">New Publication</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Add a media profile so the workflow can load it automatically at Step 1.
          </p>
        </div>

        <MediaLibraryForm />

      </div>
    </div>
  )
}
