import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import TranscriptionUploader from '@/components/transcriptions/TranscriptionUploader'

export default function NewTranscriptionPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

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
            Upload an audio recording. We&apos;ll transcribe it in real time, then you can refine the result with AI.
          </p>
        </div>

        <TranscriptionUploader userId={profile.id} />
      </div>
    </div>
  )
}
