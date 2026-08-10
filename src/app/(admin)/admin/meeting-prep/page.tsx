export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { INTERVIEW_TYPES, MEETING_PREP_PROMPT_KEYS } from '@/lib/meeting-prep'

export default async function MeetingPrepAdminPage() {
  requireAdminHeader()

  const { count } = await supabaseAdmin
    .from('meeting_prep_media_library')
    .select('id', { count: 'exact', head: true })

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Meeting Preparation', href: '/meeting-preparation' },
            { label: 'Admin' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Meeting Preparation — Admin</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Manage the reference data and prompts the Commercial Meeting Preparation workflow depends on.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Media Library</h2>
                <p className="text-xs text-gray-500 mt-1 max-w-xl">
                  One profile per TRC publication (positioning, audience &amp; reach, editorial narrative focus,
                  country). A publication with no profile here halts the workflow at Step 1.
                </p>
                <p className="text-[10px] text-gray-400 mt-2">{count ?? 0} publication{count === 1 ? '' : 's'}</p>
              </div>
              <Link
                href="/admin/meeting-prep/media-library"
                className="text-xs font-medium tracking-wider uppercase bg-black text-white px-4 py-2.5 hover:bg-gray-900 transition-colors flex-shrink-0"
              >
                Manage
              </Link>
            </div>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Planteo Library</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              The approved TRC planteo build-up formula for each variant (Appendix A). Every update is versioned
              and logged.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {INTERVIEW_TYPES.map(({ value, label }) => (
                <Link
                  key={value}
                  href={`/admin/meeting-prep/planteo-library/${value}`}
                  className="flex items-center justify-between px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors text-sm text-gray-700 hover:text-black"
                >
                  {label} variant
                  <span aria-hidden>→</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-900">Stage Prompts</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              The four sequential prompts behind the workflow — research, presentation points, planteo, and
              final document assembly.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              {MEETING_PREP_PROMPT_KEYS.map(({ key, label, description }) => (
                <Link
                  key={key}
                  href={`/admin/meeting-prep/prompts/${key}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 border border-[#e5e3df] hover:border-gray-400 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{description}</p>
                  </div>
                  <span aria-hidden className="flex-shrink-0 text-gray-400">→</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
