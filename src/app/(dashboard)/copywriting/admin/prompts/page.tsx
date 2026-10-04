export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getProfileFromHeaders } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { COPYWRITING_PROMPT_KEYS } from '@/lib/copywriting'

export default async function CopywritingPromptsAdminPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/copywriting')

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-4xl mx-auto">
        <Breadcrumbs items={[{ label: 'Copywriting Tool', href: '/copywriting' }, { label: 'Admin', href: '/copywriting/admin' }, { label: 'Stage Prompts' }]} />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Stage Prompts</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The instruction behind every stage of the workflow. Every change is saved as a new version, can be tested
            against a sample before it goes live, and can be rolled back at any time.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {COPYWRITING_PROMPT_KEYS.map(({ key, label, description }) => (
            <Link
              key={key}
              href={`/copywriting/admin/prompts/${key}`}
              className="flex items-center justify-between gap-4 px-4 py-3.5 bg-white border border-[#e5e3df] hover:border-gray-400 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm text-gray-800">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{description}</p>
              </div>
              <span aria-hidden className="flex-shrink-0 text-gray-400">→</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
