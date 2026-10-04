export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

export default async function CopywritingAdminPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/copywriting')

  const supabase = createSupabaseServerClient()
  const [{ count: pubCount }, { count: typeCount }, { count: guideCount }] = await Promise.all([
    supabase.from('copywriting_publications').select('id', { count: 'exact', head: true }),
    supabase.from('copywriting_article_types').select('id', { count: 'exact', head: true }),
    supabase.from('copywriting_trc_guides').select('id', { count: 'exact', head: true }),
  ])

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-4xl mx-auto">
        <Breadcrumbs items={[{ label: 'Copywriting Tool', href: '/copywriting' }, { label: 'Admin' }]} />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">Copywriting Tool — Admin</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Manage the reference data and prompts every article automatically draws on.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <AdminCard
            title="Publication"
            description="Publications, their country, style guides, and additional rules that apply on top of TRC house rules."
            count={`${pubCount ?? 0} publication${pubCount === 1 ? '' : 's'}`}
            href="/copywriting/admin/publications"
          />
          <AdminCard
            title="Article Type"
            description="The article types writers can choose from, each with its own additional instructions."
            count={`${typeCount ?? 0} article type${typeCount === 1 ? '' : 's'}`}
            href="/copywriting/admin/article-types"
          />
          <AdminCard
            title="TRC Guides"
            description="Style guides and approved worked examples, configured per article type — independent of any publication."
            count={`${guideCount ?? 0} file${guideCount === 1 ? '' : 's'}`}
            href="/copywriting/admin/trc-guides"
          />
          <AdminCard
            title="Stage Prompts"
            description="Analyze Sources & Styles, Research, Planning, Drafting, Check and Revision — versioned, testable and reversible."
            count="7 stages"
            href="/copywriting/admin/prompts"
          />
        </div>
      </div>
    </div>
  )
}

function AdminCard({ title, description, count, href }: { title: string; description: string; count: string; href: string }) {
  return (
    <section className="bg-white border border-[#e5e3df] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500 mt-1 max-w-xl">{description}</p>
          <p className="text-[10px] text-gray-400 mt-2">{count}</p>
        </div>
        <Link href={href} className="flex-shrink-0">
          <span className="text-xs font-medium tracking-wider uppercase bg-black text-white px-4 py-2.5 hover:bg-gray-900 transition-colors">
            Manage
          </span>
        </Link>
      </div>
    </section>
  )
}
