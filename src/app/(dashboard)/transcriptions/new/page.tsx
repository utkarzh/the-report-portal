import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import TranscriptionUploader from '@/components/transcriptions/TranscriptionUploader'
import { listMediaOptions } from '@/lib/media-library-server'

export default async function NewTranscriptionPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  const media = await listMediaOptions()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="mx-auto max-w-3xl">
        <Breadcrumbs
          items={[
            { label: 'Transcriptions', href: '/transcriptions' },
            { label: 'New Transcript' },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">New Transcript</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
            Upload an audio recording — or several files from one interview, which we&apos;ll join in order.
            We&apos;ll transcribe it, then you can refine the result with AI.
          </p>
        </div>

        <TranscriptionUploader userId={profile.id} media={media} />
      </div>
    </div>
  )
}
