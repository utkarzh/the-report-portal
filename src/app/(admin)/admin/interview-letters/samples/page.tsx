export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireAdminHeader, getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import InterviewLetterSamplesManager from '@/components/admin/InterviewLetterSamplesManager'
import { SAMPLE_LIST_COLUMNS } from '@/lib/interview-letter-samples'
import type { InterviewLetterSample } from '@/types'

export default async function InterviewLetterSamplesPage() {
  requireAdminHeader()
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const { data } = await supabaseAdmin
    .from('interview_letter_samples')
    .select(SAMPLE_LIST_COLUMNS)
    .order('created_at', { ascending: false })

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-3xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Interview Letters', href: '/interview-letters' },
            { label: 'Admin', href: '/admin/interview-letters' },
            { label: 'Sample Letters' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Sample Letters</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Past letters that show the AI the formats and styles you want. When a letter is drafted, the most relevant
            samples (same company, a matching sector, then the same letter version) are given to Claude as style
            references, up to three at a time. The letter template&apos;s structure always takes precedence, and facts are
            never copied from a sample.
          </p>
        </div>

        <InterviewLetterSamplesManager userId={profile.id} initialSamples={(data || []) as unknown as InterviewLetterSample[]} />
      </div>
    </div>
  )
}
