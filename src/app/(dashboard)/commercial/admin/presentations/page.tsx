export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { ADMIN_PATH, MODULE_PATH } from '@/lib/commercial-presentations'
import { loadStructure, loadWhyNowConfig } from '@/lib/commercial-presentations-server'
import { mediaLibraryHref } from '@/lib/media-library'

// Everything an admin controls for the Commercial Presentation Generator
// (brief §20): structure + locked methodology, agencies, media scripts, the
// Why Now prompt and its rules, and the approved reference examples.
export default async function PresentationsAdminPage() {
  requireAdminHeader()
  const [structure, whyNow, { count: agencyCount }, { count: mediaCount }, { count: scriptCount }, { count: exampleCount }] = await Promise.all([
    loadStructure(),
    loadWhyNowConfig(),
    supabaseAdmin.from('agencies').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('media_library').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('presentation_master_content').select('id', { count: 'exact', head: true }).eq('kind', 'media'),
    supabaseAdmin.from('presentation_reference_examples').select('id', { count: 'exact', head: true }).eq('active', true),
  ])

  const cards = [
    {
      title: 'Structure & locked methodology',
      description: 'The blocks, their order, the SAY / ACTION wording of the locked methodology and master templates, and the manual fields.',
      meta: structure.row ? `${structure.structure.blocks.length} blocks · v${structure.row.version_label}` : 'Not set up',
      href: `${ADMIN_PATH}/structure`,
    },
    {
      title: 'Agency profiles',
      description: 'Each agency’s approved master content, with variables. AI never rewrites it. The agencies themselves come from the central agency list shared with every tool.',
      meta: `${agencyCount ?? 0} agenc${agencyCount === 1 ? 'y' : 'ies'}`,
      href: `${ADMIN_PATH}/agencies`,
    },
    {
      title: 'Media scripts',
      description: "Each publication's approved script, in sections, and its Media Market (by default its Media Library country). Publications themselves live in the central Media Library.",
      meta: `${scriptCount ?? 0} of ${mediaCount ?? 0} publications have a script`,
      href: `${ADMIN_PATH}/media`,
    },
    {
      title: 'Why [Country] Now prompt',
      description: 'The prompt for the one AI-written block, and the rules checked on its output (length, banned phrases, web searches).',
      meta: whyNow.row ? `v${whyNow.row.version_label} · ${whyNow.config.minWords}–${whyNow.config.maxWords} words` : 'Not set up',
      href: `${ADMIN_PATH}/why-now`,
    },
    {
      title: 'Document reading instructions',
      description: 'How Claude reads an uploaded document into the structure (Structure & locked methodology → Build from a document). Starts with the built-in instructions; edit, version and reset them here.',
      meta: 'Used when building the structure from a document',
      href: `${ADMIN_PATH}/structure/import-prompt`,
    },
    {
      title: 'Approved reference examples',
      description: '10–20 strong examples that teach the AI TRC’s tone and reasoning. Never used as facts.',
      meta: `${exampleCount ?? 0} active`,
      href: `${ADMIN_PATH}/examples`,
    },
  ]

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs items={[{ label: 'Commercial Presentations', href: MODULE_PATH }, { label: 'Admin' }]} />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Commercial Presentations — Admin</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-500">
            Master content is versioned: every save keeps the previous version, and approved presentations never change when you edit it — they show “New Master Content Available” instead.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          {cards.map((c) => (
            <section key={c.href} className="border border-[#e5e3df] bg-white p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">{c.title}</h2>
                  <p className="mt-1 max-w-xl text-xs text-gray-500">{c.description}</p>
                  <p className="mt-2 text-[10px] text-gray-400">{c.meta}</p>
                </div>
                <Link href={c.href} className="flex-shrink-0 bg-black px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-white transition-colors hover:bg-gray-900">
                  Manage
                </Link>
              </div>
            </section>
          ))}
          <p className="text-xs text-gray-500">
            Publications are added in the <Link href={mediaLibraryHref('commercial-presentations')} className="underline">Media Library</Link>. Who can use and approve presentations is set per user in Admin → Users.
          </p>
        </div>
      </div>
    </div>
  )
}
