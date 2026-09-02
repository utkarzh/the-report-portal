export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import InterviewLetterTemplateForm from '@/components/admin/InterviewLetterTemplateForm'
import { isInterviewLetterCompany, INTERVIEW_LETTER_COMPANIES } from '@/lib/interview-letters'
import type { InterviewLetterParagraphSlot } from '@/types'

interface Props {
  params: { company: string }
}

export default async function InterviewLetterTemplatePage({ params }: Props) {
  requireAdminHeader()

  if (!isInterviewLetterCompany(params.company)) notFound()

  const label = INTERVIEW_LETTER_COMPANIES.find((c) => c.value === params.company)?.label || params.company

  const { data } = await supabaseAdmin
    .from('interview_letter_templates')
    .select('structure, updated_at')
    .eq('company', params.company)
    .maybeSingle()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-3xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Interview Letters', href: '/interview-letters' },
            { label: 'Admin', href: '/admin/interview-letters' },
            { label: `${params.company} Template` },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">{label} — Letter Template</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The fixed wording and variable paragraph structure (with word budgets) used to generate every {params.company} Interview Request Letter. Changing this never retroactively alters a letter already generated or approved under an earlier version.
          </p>
          {data?.updated_at && (
            <p className="text-xs text-gray-400 mt-2">Last updated {new Date(data.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          )}
        </div>

        <InterviewLetterTemplateForm
          company={params.company}
          label={params.company}
          initialStructure={(data?.structure || []) as InterviewLetterParagraphSlot[]}
        />
      </div>
    </div>
  )
}
