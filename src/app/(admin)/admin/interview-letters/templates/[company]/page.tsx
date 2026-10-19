export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import InterviewLetterTemplateForm from '@/components/admin/InterviewLetterTemplateForm'
import {
  INTERVIEW_LETTER_COMPANIES,
  INTERVIEW_LETTER_VARIANTS,
  isInterviewLetterCompany,
  isInterviewLetterVariant,
} from '@/lib/interview-letters'
import type { InterviewLetterParagraphSlot } from '@/types'

interface Props {
  params: { company: string }
  searchParams: { variant?: string }
}

export default async function InterviewLetterTemplatePage({ params, searchParams }: Props) {
  requireAdminHeader()

  if (!isInterviewLetterCompany(params.company)) notFound()
  const variant = isInterviewLetterVariant(searchParams.variant) ? searchParams.variant : 'anchor'
  const variantMeta = INTERVIEW_LETTER_VARIANTS.find((v) => v.value === variant)!

  const label = INTERVIEW_LETTER_COMPANIES.find((c) => c.value === params.company)?.label || params.company

  const { data } = await supabaseAdmin
    .from('interview_letter_templates')
    .select('structure, updated_at')
    .eq('company', params.company)
    .eq('variant', variant)
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

        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">{label} — Letter Templates</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Each company has two versions of its letter. The fixed wording and variable paragraph structure (with word budgets) of the version you pick here is used for every {params.company} letter of that kind. Changing it never retroactively alters a letter already generated or approved.
          </p>
        </div>

        <div className="mb-6 flex gap-2 border-b border-[#e5e3df]">
          {INTERVIEW_LETTER_VARIANTS.map((v) => (
            <Link
              key={v.value}
              href={`/admin/interview-letters/templates/${params.company}?variant=${v.value}`}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors ${
                v.value === variant ? 'border-black font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-black'
              }`}
            >
              {v.label}
            </Link>
          ))}
        </div>

        <div className="mb-8">
          <p className="text-sm text-gray-600 max-w-2xl">{variantMeta.description}</p>
          {data?.updated_at && (
            <p className="text-xs text-gray-400 mt-2">Last updated {new Date(data.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          )}
        </div>

        <InterviewLetterTemplateForm
          key={variant}
          company={params.company}
          variant={variant}
          label={`${params.company} (${variantMeta.label.toLowerCase()})`}
          initialStructure={(data?.structure || []) as InterviewLetterParagraphSlot[]}
        />
      </div>
    </div>
  )
}
