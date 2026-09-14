export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Handshake, ShieldCheck, Loader2, CheckCircle2, AlertCircle, Flag, Sparkles, BookOpenText, Database } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { reconcilePendingNegotiations } from '@/lib/assemblyai/reconcile'
import { SALES_COACH_STAGE_LABELS, formatScore, outcomeLabel } from '@/lib/sales-coach'
import PrivacyNotice from '@/components/sales-coach/PrivacyNotice'
import DeleteNegotiationButton from '@/components/sales-coach/DeleteNegotiationButton'
import EntityCard from '@/components/ui/EntityCard'
import ListPagination from '@/components/ui/ListPagination'
import StatusPill, { type PillTone } from '@/components/ui/StatusPill'
import type { SalesCoachStage } from '@/types'

const PAGE_SIZE = 12

export default async function SalesCoachPage({ searchParams }: { searchParams: { page?: string } }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  const isAdmin = profile.role === 'admin'

  // Heal any audio submission that finished transcribing while no tab was
  // polling, so it doesn't sit at "Transcribing" in the list.
  await reconcilePendingNegotiations(isAdmin ? {} : { userId: profile.id })

  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // RLS: a Sales Executive sees only their own submissions (US-044); an admin
  // sees every negotiation across the team, like every other module.
  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('sales_coach_negotiations')
    .select('id, user_id, submitted_by_name, company, country, media_publication, declared_outcome, ai_assessed_position, execution_score, execution_denominator, management_review, stage, cost_usd, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  if (!isAdmin) query = query.eq('user_id', profile.id)

  const { data: rows, count } = await query
  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const creatorNameMap = new Map<string, string>()
  if (isAdmin && rows?.length) {
    const userIds = rows.map((r) => r.user_id).filter((id): id is string => Boolean(id))
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds)
      profiles?.forEach((p) => creatorNameMap.set(p.id, p.full_name || 'Unknown user'))
    }
  }

  // Privacy-notice acknowledgement isn't in the header profile — read it directly.
  const { data: ack } = await supabaseAdmin
    .from('profiles')
    .select('sales_coach_privacy_ack_at')
    .eq('id', profile.id)
    .single()
  const acknowledged = Boolean(ack?.sales_coach_privacy_ack_at)

  const items = (rows || []).map((r) => ({
    ...r,
    creatorName: isAdmin ? (r.user_id ? creatorNameMap.get(r.user_id) || r.submitted_by_name || 'Deleted user' : r.submitted_by_name || 'Deleted user') : null,
  }))

  return (
    <div className="p-8">
      <PrivacyNotice acknowledged={acknowledged} />

      <div className="mt-4 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700"><Handshake size={18} /></div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Sales Coach</h1>
            <p className="mt-1 text-sm text-gray-500">
              {isAdmin
                ? 'Every negotiation submitted across the team, with its Report Card and coaching.'
                : 'Submit a negotiation to get a Report Card and coaching. Only you see your own submissions.'}
            </p>
          </div>
        </div>
        <Link
          href="/sales-coach/new"
          className="group inline-flex items-center gap-2.5 rounded-xl bg-black py-2.5 pl-3 pr-4 text-sm font-medium tracking-wide text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gray-900 hover:shadow-md"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15 transition-colors group-hover:bg-white/25">
            <Handshake size={14} />
          </span>
          <span>New negotiation</span>
          <Plus size={15} className="opacity-60 transition-opacity group-hover:opacity-100" />
        </Link>
      </div>

      {isAdmin && (
        <div className="mb-6 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 rounded-lg bg-[#c8973f]/10 p-2 text-[#a07530]"><ShieldCheck size={18} /></div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">Admin tools</p>
                <p className="mt-0.5 text-sm text-gray-600">Manage the four TRC knowledge documents and review the negotiations database.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <AdminLink href="/admin/sales-coach" icon={<BookOpenText size={14} className="text-[#a07530]" />} label="Knowledge documents" />
              <AdminLink href="/admin/sales-coach/negotiations" icon={<Database size={14} className="text-[#a07530]" />} label="Negotiations database" />
            </div>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500 shadow-sm">
          <div className="rounded-lg bg-[#f7f6f3] p-2 text-gray-600"><Handshake size={16} /></div>
          <span>{isAdmin ? 'No negotiations have been submitted yet.' : 'No negotiations yet. Submit one to get your first Report Card.'}</span>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((r, i) => (
              <EntityCard
                key={r.id}
                index={i}
                href={`/sales-coach/${r.id}`}
                icon={<Handshake size={16} />}
                title={r.company || 'Untitled negotiation'}
                subtitle={[r.country, r.media_publication].filter(Boolean).join(' · ') || outcomeLabel(r.declared_outcome)}
                date={new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                creatorName={r.creatorName}
                badge={<StageBadge stage={r.stage as SalesCoachStage} />}
                metaRight={
                  <span className="flex flex-shrink-0 items-center gap-1.5">
                    {r.management_review && (
                      <span title="Flagged for management review" className="inline-flex items-center gap-1 rounded-full bg-[#fbf7ed] px-2 py-0.5 text-[11px] font-medium text-[#a07530]"><Flag size={10} /> Review</span>
                    )}
                    {typeof r.execution_score === 'number' && typeof r.execution_denominator === 'number' && (
                      <span title={r.ai_assessed_position || 'Execution score'} className="inline-flex items-center rounded-full bg-black px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white">
                        {formatScore(Number(r.execution_score), r.execution_denominator)}
                      </span>
                    )}
                    {isAdmin && Number(r.cost_usd) > 0 && (
                      <span title="AI cost" className="inline-flex items-center gap-1 rounded-full bg-[#f7f6f3] px-2 py-0.5 text-[11px] font-medium tabular-nums text-gray-600"><Sparkles size={10} />${Number(r.cost_usd).toFixed(4)}</span>
                    )}
                  </span>
                }
                footerLabel={r.stage === 'complete' ? 'Open Report Card' : 'Open negotiation'}
                deleteSlot={isAdmin ? <DeleteNegotiationButton negotiationId={r.id} title={r.company || 'this negotiation'} variant="icon" /> : undefined}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <ListPagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={PAGE_SIZE} basePath="/sales-coach" label="negotiations" />
          )}
        </>
      )}
    </div>
  )
}

function AdminLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2 rounded-lg border border-[#c8973f]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c8973f]/50 hover:text-[#a07530] hover:shadow">
      {icon}<span>{label}</span>
    </Link>
  )
}

function StageBadge({ stage }: { stage: SalesCoachStage }) {
  const map: Record<SalesCoachStage, { tone: PillTone; icon?: React.ReactNode }> = {
    draft: { tone: 'stone' },
    transcribing: { tone: 'amber', icon: <Loader2 size={12} className="animate-spin" /> },
    transcribed: { tone: 'sky' },
    analyzing: { tone: 'amber', icon: <Loader2 size={12} className="animate-spin" /> },
    complete: { tone: 'emerald', icon: <CheckCircle2 size={12} /> },
    failed: { tone: 'red', icon: <AlertCircle size={12} /> },
  }
  const s = map[stage] ?? map.draft
  return <StatusPill label={SALES_COACH_STAGE_LABELS[stage] || stage} tone={s.tone} icon={s.icon} />
}
