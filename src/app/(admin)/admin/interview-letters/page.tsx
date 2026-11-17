export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import InterviewLetterResearchEngine from '@/components/admin/InterviewLetterResearchEngine'
import { INTERVIEW_LETTER_VARIANTS } from '@/lib/interview-letters'
import { agenciesHref } from '@/lib/agencies'
import { listAgencies } from '@/lib/agencies-server'
import { geminiConfigured, getResearchProvider } from '@/lib/interview-letter-research'

const RESEARCH_PLACEHOLDERS = ['COMPANY', 'PROJECT_COUNTRY', 'MEDIA_PARTNER', 'TARGET_MARKET', 'USER_CONTEXT', 'CURRENT_DATE', 'ANCHOR', 'PUBLICATION_TIMING', 'REPORT_SECTOR']

export default async function InterviewLettersAdminPage() {
  requireAdminHeader()

  const [provider, mediaCount, sampleCount, agencies, templates, researchPrompts, emailPrompts] = await Promise.all([
    getResearchProvider(),
    supabaseAdmin.from('media_library').select('id', { count: 'exact', head: true }).neq('letter_description', '').then((r) => r.count ?? 0),
    supabaseAdmin.from('interview_letter_samples').select('id', { count: 'exact', head: true }).then((r) => r.count ?? 0),
    // The central agency list (Admin → Agencies) — every agency gets its own
    // templates and prompts here.
    listAgencies(),
    supabaseAdmin.from('interview_letter_templates').select('company, variant, structure').then((r) => r.data || []),
    supabaseAdmin.from('interview_letter_research_prompts').select('company, prompt_text').then((r) => r.data || []),
    supabaseAdmin.from('interview_letter_email_prompts').select('company, prompt_text').then((r) => r.data || []),
  ])
  const companies = agencies.map((a) => ({ value: a.code, label: `${a.name} (${a.code})${a.active ? '' : ' — inactive'}` }))
  const hasTemplate = (code: string, variant: string) =>
    templates.some((t) => t.company === code && t.variant === variant && Array.isArray(t.structure) && t.structure.length > 0)
  const hasPrompt = (rows: { company: string; prompt_text: string | null }[], code: string) =>
    rows.some((r) => r.company === code && (r.prompt_text || '').trim().length > 0)
  const notSetUp = <span className="text-amber-700"> · not set up yet</span>

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Interview Letters', href: '/interview-letters' },
            { label: 'Admin' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Interview Letters — Admin</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Manage everything the Interview Request Letter &amp; Email Generator depends on: the research engine and
            prompt, the two letter versions per agency, the media descriptions, sample letters and the email
            prompt. Research builds on the country&apos;s Editorial Brief when one exists. Every write-up is done by
            Claude.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Agencies</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              The companies letters are written for come from the central agency list, shared with every tool. A new
              agency needs its own research prompt, letter templates and email prompt below before letters can be
              generated for it. Existing letters keep the agency they were created with.
            </p>
            <Link
              href={agenciesHref('interview-letters')}
              className="mt-4 flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
            >
              <span>
                Agencies <span className="text-gray-400">· {agencies.filter((a) => a.active).length} active</span>
              </span>
              <span aria-hidden>→</span>
            </Link>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Research Engine</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Which AI runs the research step. It uses the Editorial Brief for the project&apos;s country as its main
              reference, checks the facts and looks for anything newer. The letter, email and personalised versions
              are always written by Claude.
            </p>
            <InterviewLetterResearchEngine initialProvider={provider} geminiConfigured={geminiConfigured()} />
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Research Prompt</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Controls the first step of every project: what gets researched and how the why-now hook is proposed. Set
              separately per company. Every update is versioned with full rollback.
            </p>
            <p className="text-xs text-gray-400 mt-2 max-w-xl leading-relaxed">
              Placeholders filled in from each project:{' '}
              {RESEARCH_PLACEHOLDERS.map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  <code className="bg-[#f0efec] px-1 text-[11px] text-gray-600">{`{{${p}}}`}</code>
                </span>
              ))}
              .
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {companies.map(({ value, label }) => (
                <Link
                  key={value}
                  href={`/admin/interview-letters/research-prompt/${value}`}
                  className="flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
                >
                  <span>
                    {label}
                    {!hasPrompt(researchPrompts, value) && notSetUp}
                  </span>
                  <span aria-hidden>→</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Letter Templates</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Two versions per company. <strong className="font-medium text-gray-700">With an anchor</strong> introduces
              the event or publication occasion in the second paragraph and explains how it connects to the report.{' '}
              <strong className="font-medium text-gray-700">Without an anchor</strong> opens with the report&apos;s purpose
              and mentions publication timing later. Each has its own fixed wording, paragraph structure and word
              budgets. Every update is versioned with full rollback.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {companies.flatMap(({ value, label }) =>
                INTERVIEW_LETTER_VARIANTS.map((v) => (
                  <Link
                    key={`${value}-${v.value}`}
                    href={`/admin/interview-letters/templates/${value}?variant=${v.value}`}
                    className="flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
                  >
                    <span>
                      {label} <span className="text-gray-400">· {v.label.toLowerCase()}</span>
                      {!hasTemplate(value, v.value) && notSetUp}
                    </span>
                    <span aria-hidden>→</span>
                  </Link>
                )),
              )}
            </div>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Media</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Publications are managed in the central Media Library, shared by every tool. Each one&apos;s letter
              description (its exact wording, stating audience and geographic reach) is copied into the letter as
              written wherever the template says [Approved Media Partner Description].
            </p>
            <Link
              href="/admin/media-library?from=interview-letters"
              className="mt-4 flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
            >
              <span>
                Media Library <span className="text-gray-400">· {mediaCount} with a letter description</span>
              </span>
              <span aria-hidden>→</span>
            </Link>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Sample Letters</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Past letters that show the AI the formats and styles you want, tagged by company, letter version and
              sector (e.g. tourism, security). The most relevant ones are used as style references for each new letter.
            </p>
            <Link
              href="/admin/interview-letters/samples"
              className="mt-4 flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
            >
              <span>
                Sample letters <span className="text-gray-400">· {sampleCount} uploaded</span>
              </span>
              <span aria-hidden>→</span>
            </Link>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Email Prompt</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Controls the cover email drafted once the letter is approved — a separate document from the letter, set
              per company. Every update is versioned with full rollback.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {companies.map(({ value, label }) => (
                <Link
                  key={value}
                  href={`/admin/interview-letters/email-prompt/${value}`}
                  className="flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
                >
                  <span>
                    {label}
                    {!hasPrompt(emailPrompts, value) && notSetUp}
                  </span>
                  <span aria-hidden>→</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
