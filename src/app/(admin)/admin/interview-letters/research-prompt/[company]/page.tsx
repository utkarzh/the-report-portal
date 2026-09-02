export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isInterviewLetterCompany, INTERVIEW_LETTER_COMPANIES } from '@/lib/interview-letters'
import InterviewLetterResearchPromptForm from '@/components/admin/InterviewLetterResearchPromptForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

interface Props {
  params: { company: string }
}

export default async function InterviewLetterResearchPromptPage({ params }: Props) {
  requireAdminHeader()

  if (!isInterviewLetterCompany(params.company)) notFound()
  const company = params.company
  const label = INTERVIEW_LETTER_COMPANIES.find((c) => c.value === company)?.label ?? company

  const { data: row } = await supabaseAdmin
    .from('interview_letter_research_prompts')
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
            { label: `${label} Research Prompt` },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">{label} — Research Prompt</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Controls the first step of every {label} project — what Claude researches and how it proposes a why-now
            hook, before the letter is drafted. Every update is versioned with full rollback.
          </p>
        </div>

        <InterviewLetterResearchPromptForm company={company} label={label} initialPrompt={row?.prompt_text || ''} />
      </div>
    </div>
  )
}
