export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Handshake, CalendarDays, ShieldCheck } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import PrivacyNotice from '@/components/sales-coach/PrivacyNotice'

const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft',
  transcribing: 'Transcribing',
  transcribed: 'Ready to analyse',
  analyzing: 'Analysing',
  complete: 'Complete',
  failed: 'Failed',
}

const OUTCOME_LABELS: Record<string, string> = {
  signed: 'Signed on the spot',
  retorno: 'Retorno',
  lost: 'Lost',
  uncertain: 'Uncertain',
}

export default async function SalesCoachPage() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  // US-044: a Sales Executive sees only their own submissions.
  const { data: rows } = await supabase
    .from('sales_coach_negotiations')
    .select('id, company, country, media_publication, declared_outcome, ai_assessed_position, execution_score, execution_denominator, stage, created_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Privacy-notice acknowledgement isn't in the header profile — read it directly.
  const { data: ack } = await supabaseAdmin
    .from('profiles')
    .select('sales_coach_privacy_ack_at')
    .eq('id', profile.id)
    .single()
  const acknowledged = Boolean(ack?.sales_coach_privacy_ack_at)

  return (
    <div className="p-8">
      <PrivacyNotice acknowledged={acknowledged} />

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700"><Handshake size={18} /></div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Sales Coach</h1>
            <p className="mt-1 text-sm text-gray-500">Submit a negotiation to get a Report Card and coaching. Only you see your own submissions.</p>
          </div>
        </div>
        <Link href="/sales-coach/new" className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900">
          <Plus size={15} /> New negotiation
        </Link>
      </div>

      {profile.role === 'admin' && (
        <div className="mt-6 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 rounded-lg bg-[#c8973f]/10 p-2 text-[#a07530]">
                <ShieldCheck size={18} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">Admin tools</p>
                <p className="text-sm text-gray-600 mt-0.5">Manage the four TRC knowledge documents and browse every negotiation.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/sales-coach" className="group inline-flex items-center gap-2 rounded-lg border border-[#c8973f]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c8973f]/50 hover:text-[#a07530] hover:shadow">
                <ShieldCheck size={14} className="text-[#a07530]" />
                <span>Admin area</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {(!rows || rows.length === 0) ? (
        <div className="mt-6 rounded-xl border border-[#e5e3df] bg-white p-8 text-sm text-gray-500">
          No negotiations yet. Submit one to get your first Report Card.
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <Link key={r.id} href={`/sales-coach/${r.id}`} className="block rounded-xl border border-[#e5e3df] bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-gray-400">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">{r.company || 'Untitled negotiation'}</p>
                <span className="rounded-full border border-[#e5e3df] bg-[#f7f6f3] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">{STAGE_LABELS[r.stage] || r.stage}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500 truncate">{[r.country, r.media_publication].filter(Boolean).join(' · ') || '—'}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                <span>{OUTCOME_LABELS[r.declared_outcome as string] || '—'}</span>
                {typeof r.execution_score === 'number' && typeof r.execution_denominator === 'number' && (
                  <span className="font-semibold tabular-nums text-gray-800">{r.execution_score}/{r.execution_denominator}</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
                <CalendarDays size={11} />
                {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
