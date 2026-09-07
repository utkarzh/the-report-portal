export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { INTERVIEW_LETTER_COMPANIES } from '@/lib/interview-letters'

export default function InterviewLettersAdminPage() {
  requireAdminHeader()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
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
            Manage the research prompt, letter template, and email prompt the Interview Request Letter &amp; Email
            Generator depends on. The letter and the email are drafted separately, each from its own admin-managed
            content.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Research Prompt</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Controls the first step of every project — what Claude researches and how it proposes a why-now hook —
              set separately per company. Every update is versioned with full rollback.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {INTERVIEW_LETTER_COMPANIES.map(({ value, label }) => (
                <Link
                  key={value}
                  href={`/admin/interview-letters/research-prompt/${value}`}
                  className="flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
                >
                  {label}
                  <span aria-hidden>→</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Letter Templates</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              The fixed wording, variable-paragraph structure, and per-paragraph word budgets for each company. Every
              update is versioned with full rollback.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {INTERVIEW_LETTER_COMPANIES.map(({ value, label }) => (
                <Link
                  key={value}
                  href={`/admin/interview-letters/templates/${value}`}
                  className="flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
                >
                  {label}
                  <span aria-hidden>→</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Email Prompt</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              Controls the cover email drafted once the letter is approved — a separate document from the letter, set
              per company. Every update is versioned with full rollback.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {INTERVIEW_LETTER_COMPANIES.map(({ value, label }) => (
                <Link
                  key={value}
                  href={`/admin/interview-letters/email-prompt/${value}`}
                  className="flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
                >
                  {label}
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
