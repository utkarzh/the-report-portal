export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import StatusPill from '@/components/ui/StatusPill'
import { ADMIN_PATH, MODULE_PATH, agencyHasContent, validateAgencyContent } from '@/lib/commercial-presentations'
import { agenciesHref } from '@/lib/agencies'
import { listAgencies } from '@/lib/agencies-server'

// Agencies themselves are managed in the central list (Admin → Agencies),
// shared with every tool. What's specific to presentations is each agency's
// optional Block 2 wording, edited from here.
export default async function PresentationAgenciesPage() {
  requireAdminHeader()
  const [agencies, { data: overrides }] = await Promise.all([
    listAgencies(),
    supabaseAdmin.from('presentation_master_content').select('ref_id, content').eq('kind', 'agency'),
  ])
  const ownWording = new Set(
    (overrides || []).filter((o) => agencyHasContent(validateAgencyContent(o.content))).map((o) => o.ref_id as string),
  )

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs items={[{ label: 'Commercial Presentations', href: MODULE_PATH }, { label: 'Admin', href: ADMIN_PATH }, { label: 'Agency profiles' }]} />
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Agency profiles</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
              Agency approved master content, with variables. AI never rewrites it. The agencies themselves come from
              the central agency list shared with every tool.
            </p>
          </div>
          <Link
            href={agenciesHref('commercial-presentations')}
            className="flex-shrink-0 bg-black px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-white transition-colors hover:bg-gray-900"
          >
            Manage agencies
          </Link>
        </div>
        <ul className="divide-y divide-[#efede9] border border-[#e5e3df] bg-white">
          {agencies.map((a) => (
            <li key={a.id}>
              <Link href={`${ADMIN_PATH}/agencies/${a.id}`} className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-gray-50">
                <span className="min-w-0">
                  <span className="block text-sm text-gray-800">
                    {a.name} <span className="font-mono text-xs text-gray-400">{a.code}</span>
                  </span>
                  {!a.active && <span className="block text-xs text-gray-400">Inactive — not offered for new presentations</span>}
                </span>
                <StatusPill label={ownWording.has(a.id) ? 'Own details' : 'Standard details'} tone={ownWording.has(a.id) ? 'emerald' : 'stone'} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
