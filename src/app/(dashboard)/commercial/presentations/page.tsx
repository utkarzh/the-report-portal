export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Presentation, ShieldCheck } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMissingTable } from '@/lib/knowledge/schema-compat'
import EntityCard from '@/components/ui/EntityCard'
import SearchInput from '@/components/ui/SearchInput'
import StatusPill from '@/components/ui/StatusPill'
import ListPagination from '@/components/ui/ListPagination'
import { ADMIN_PATH, MODULE_PATH, presentationStatus } from '@/lib/commercial-presentations'
import { NOT_INSTALLED_MESSAGE } from '@/lib/commercial-presentations-server'
import type { CommercialPresentation, Project } from '@/types'

const PAGE_SIZE = 12

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'submitted', label: 'Awaiting approval' },
  { key: 'draft', label: 'Drafts' },
  { key: 'approved', label: 'Approved' },
] as const

type Row = Pick<CommercialPresentation, 'id' | 'status' | 'approved_snapshot_id' | 'updated_at' | 'created_at'> & {
  project: Pick<Project, 'name' | 'agency_name' | 'country' | 'media_name' | 'edition'> | null
}

// Presentations are generated at project level and shared by the team, so
// every module user sees every project's presentation.
export default async function CommercialPresentationsPage({
  searchParams,
}: {
  searchParams: { page?: string; search?: string; status?: string }
}) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const search = (searchParams.search || '').trim().toLowerCase()
  const status = FILTERS.some((f) => f.key === searchParams.status) ? searchParams.status || '' : ''
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))

  const { data, error } = await supabaseAdmin
    .from('commercial_presentations')
    .select('id, status, approved_snapshot_id, updated_at, created_at, project:projects(name, agency_name, country, media_name, edition)')
    .order('updated_at', { ascending: false })
    .limit(500)
  const installed = !(error && isMissingTable(error))

  const all = ((data || []) as unknown as Row[]).filter((r) => r.project)
  const filtered = all.filter((r) => {
    if (status && r.status !== status) return false
    if (!search) return true
    const p = r.project!
    return [p.name, p.agency_name, p.country, p.media_name, p.edition].some((v) => (v || '').toLowerCase().includes(search))
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const awaiting = all.filter((r) => r.status === 'submitted').length
  const canApprove = profile.role === 'admin' || profile.can_approve_commercial_presentations

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700">
            <Presentation size={18} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Commercial Presentations</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              The standard opening presentation for each project, delivered before the interview. TRC&apos;s approved methodology, agency and media wording are assembled automatically; only “Why [Country] Now” is written by AI. A Manager approves and locks it before use.
            </p>
          </div>
        </div>
        <Link
          href={`${MODULE_PATH}/new`}
          className="group inline-flex items-center gap-2.5 rounded-xl bg-black py-2.5 pl-3 pr-4 text-sm font-medium tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15">
            <Presentation size={14} />
          </span>
          <span>New presentation</span>
          <Plus size={15} className="opacity-60" />
        </Link>
      </div>

      {!installed && <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{NOT_INSTALLED_MESSAGE}</div>}

      {profile.role === 'admin' && (
        <div className="mb-6 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 rounded-lg bg-[#c8973f]/10 p-2 text-[#a07530]">
                <ShieldCheck size={18} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">Admin tools</p>
                <p className="mt-0.5 text-sm text-gray-600">Structure and locked methodology, agencies, media scripts, the Why Now prompt and reference examples.</p>
              </div>
            </div>
            <Link href={ADMIN_PATH} className="inline-flex items-center gap-2 rounded-lg border border-[#c8973f]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-[#c8973f]/50 hover:text-[#a07530]">
              <ShieldCheck size={14} className="text-[#a07530]" /> Admin area
            </Link>
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput basePath={MODULE_PATH} initialValue={searchParams.search || ''} placeholder="Search by project, country, media…" />
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key ? `${MODULE_PATH}?status=${f.key}` : MODULE_PATH}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${status === f.key ? 'bg-black text-white' : 'border border-[#e5e3df] bg-white text-gray-600 hover:text-black'}`}
            >
              {f.label}
              {f.key === 'submitted' && awaiting > 0 && canApprove ? ` (${awaiting})` : ''}
            </Link>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500 shadow-sm">
          {search || status ? 'No presentations match.' : 'No commercial presentations yet. Create one for your project to get started.'}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((r, i) => {
              const st = presentationStatus(r)
              return (
                <EntityCard
                  key={r.id}
                  index={i}
                  href={`${MODULE_PATH}/${r.id}`}
                  icon={<Presentation size={16} />}
                  title={r.project!.name}
                  subtitle={[r.project!.agency_name, r.project!.media_name, r.project!.country].filter(Boolean).join(' · ')}
                  date={new Date(r.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  badge={<StatusPill label={st.label} tone={st.tone} pulse={r.status === 'submitted'} />}
                  footerLabel="Open presentation"
                />
              )
            })}
          </div>
          {totalPages > 1 && (
            <ListPagination
              page={page}
              totalPages={totalPages}
              totalCount={filtered.length}
              pageSize={PAGE_SIZE}
              basePath={MODULE_PATH}
              label="presentations"
              search={searchParams.search || ''}
            />
          )}
        </>
      )}
    </div>
  )
}
