export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Plus, Radar, ShieldCheck } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/admin'
import EntityCard from '@/components/ui/EntityCard'
import StatusPill, { type PillTone } from '@/components/ui/StatusPill'
import { isMissingCiTable, CI_NOT_INSTALLED } from '@/lib/country-intel/auth'
import { DEPTHS } from '@/lib/country-intel/depth'
import type { CiProject } from '@/lib/country-intel/types'

const STATUS: Record<string, { label: string; tone: PillTone }> = {
  draft: { label: 'Not started', tone: 'stone' },
  running: { label: 'Researching', tone: 'amber' },
  paused: { label: 'Paused', tone: 'sky' },
  complete: { label: 'Complete', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'red' },
}

export default async function CountryIntelligencePage() {
  const { data, error } = await supabaseAdmin.from('ci_projects').select('*').order('created_at', { ascending: false }).limit(60)
  const projects = (data || []) as CiProject[]
  const ids = projects.map((p) => p.id)
  const counts = new Map<string, number>()
  if (ids.length) {
    const { data: cs } = await supabaseAdmin.from('ci_companies').select('project_id, verdict').in('project_id', ids).eq('status', 'profiled')
    for (const c of cs || []) if ((c.verdict as { pass?: boolean } | null)?.pass) counts.set(c.project_id as string, (counts.get(c.project_id as string) || 0) + 1)
  }

  return (
    <div className="p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700"><Radar size={18} /></div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Country Intelligence</h1>
            <p className="text-sm text-gray-500 mt-1 max-w-3xl">Builds a sourced list of the companies in a country that meet TRC&apos;s commercial criteria — company and leader profiles, revenue checked against the threshold, who to approach with their published phone, mobile and email — and exports it as the country report (PDF) or a spreadsheet.</p>
          </div>
        </div>
        <Link href="/commercial/country-intelligence/new" className="group inline-flex items-center gap-2.5 rounded-xl bg-black py-2.5 pl-3 pr-4 text-sm font-medium tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15"><Radar size={14} /></span>
          <span>New research</span>
          <Plus size={15} className="opacity-60" />
        </Link>
      </div>

      <div className="mb-6 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 rounded-lg bg-[#c8973f]/10 p-2 text-[#a07530]"><ShieldCheck size={18} /></div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">Admin tools</p>
              <p className="text-sm text-gray-600 mt-0.5">Edit the Country Intelligence system prompt (the research rules every run follows).</p>
            </div>
          </div>
          <Link href="/commercial/admin/country-intelligence" className="inline-flex items-center gap-2 rounded-lg border border-[#c8973f]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-[#c8973f]/50 hover:text-[#a07530]">
            <ShieldCheck size={14} className="text-[#a07530]" /><span>System prompt</span>
          </Link>
        </div>
      </div>

      {isMissingCiTable(error) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{CI_NOT_INSTALLED}</div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500 shadow-sm">No research yet. Start one to build a country&apos;s company list.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p, i) => {
            const st = STATUS[p.status] || STATUS.draft
            return (
              <EntityCard
                key={p.id}
                index={i}
                href={`/commercial/country-intelligence/${p.id}`}
                icon={<Radar size={16} />}
                title={p.title}
                subtitle={`${p.country} · ${DEPTHS[p.depth].label} · ${counts.get(p.id) || 0} of ${p.target_count} companies · $${Number(p.spent_usd).toFixed(2)} spent`}
                date={new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                badge={<StatusPill label={st.label} tone={st.tone} pulse={p.status === 'running'} />}
                footerLabel="Open research"
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
