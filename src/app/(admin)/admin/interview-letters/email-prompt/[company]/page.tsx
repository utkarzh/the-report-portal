export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isInterviewLetterCompany, INTERVIEW_LETTER_COMPANIES } from '@/lib/interview-letters'
import InterviewLetterEmailPromptForm from '@/components/admin/InterviewLetterEmailPromptForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

interface Props {
  params: { company: string }
}

export default async function InterviewLetterEmailPromptPage({ params }: Props) {
  requireAdminHeader()

  if (!isInterviewLetterCompany(params.company)) notFound()
  const company = params.company
  const label = INTERVIEW_LETTER_COMPANIES.find((c) => c.value === company)?.label ?? company

  const { data: row } = await supabaseAdmin
    .from('interview_letter_email_prompts')
    .select('prompt_text')
    .eq('company', company)
    .maybeSingle()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Interview Letters', href: '/interview-letters' },
            { label: 'Admin', href: '/admin/interview-letters' },
            { label: `${label} Email Prompt` },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">{label} — Email Prompt</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Controls the cover email drafted once the letter is approved — its own document, not a condensed copy of
            the letter (subject line, why-now summary, reference to the attached letter, logistics, sign-off). The
            sender&apos;s name, title, and contact details are supplied per project and are not part of this prompt.
            Every update is versioned with full rollback.
          </p>
        </div>

        <InterviewLetterEmailPromptForm company={company} label={label} initialPrompt={row?.prompt_text || ''} />
      </div>
    </div>
  )
}
