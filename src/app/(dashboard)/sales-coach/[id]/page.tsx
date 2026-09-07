export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import CoachConversation from '@/components/sales-coach/CoachConversation'
import type { SalesCoachNegotiation, SalesCoachMessage } from '@/types'

const OUTCOME_LABELS: Record<string, string> = {
  signed: 'Signed on the spot', retorno: 'Retorno', lost: 'Lost', uncertain: 'Uncertain',
}

// Phase 1 detail view — shows the submitted record and its stage. The Report
// Card generation, rendering, and coaching conversation land in Phase 2.
export default async function NegotiationDetailPage({ params }: { params: { id: string } }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  // RLS scopes this to the owner (admins see all).
  const supabase = createSupabaseServerClient()
  const { data } = await supabase
    .from('sales_coach_negotiations')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!data) notFound()
  const n = data as SalesCoachNegotiation

  // The coaching conversation needs something to coach on: a transcript
  // (uploaded or system-generated) or an already-produced Report Card.
  const canCoach = Boolean(n.system_transcript || n.uploaded_transcript || n.report_card)

  const { data: msgRows } = await supabase
    .from('sales_coach_messages')
    .select('id, negotiation_id, role, content, created_at')
    .eq('negotiation_id', n.id)
    .order('created_at', { ascending: true })
  const messages = (msgRows || []) as SalesCoachMessage[]

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="mx-auto max-w-3xl">
        <Breadcrumbs items={[{ label: 'Sales Coach', href: '/sales-coach' }, { label: n.company || 'Negotiation' }]} />

        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{n.company || 'Negotiation'}</h1>
            <p className="mt-1 text-sm text-gray-500">{[n.country, n.media_publication].filter(Boolean).join(' · ') || '—'}</p>
          </div>
          <span className="rounded-full border border-[#e5e3df] bg-[#f7f6f3] px-3 py-1 text-xs font-medium text-gray-600">{n.stage}</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Interviewee" value={[n.interviewee_name, n.interviewee_position].filter(Boolean).join(' — ')} />
          <Field label="Declared outcome" value={OUTCOME_LABELS[n.declared_outcome || ''] || '—'} />
          <Field label="Company representatives" value={n.company_reps.map((p) => [p.name, p.role].filter(Boolean).join(' — ')).join('; ') || '—'} />
          <Field label="TRC team members" value={n.trc_members.map((p) => [p.name, p.role].filter(Boolean).join(' — ')).join('; ') || '—'} />
        </div>

        {n.other_comments && (
          <div className="mt-4"><Field label="Other comments" value={n.other_comments} /></div>
        )}

        {!n.report_card && (
          <div className="mt-8 rounded-xl border border-dashed border-[#d4d0c8] bg-[#faf9f7] px-4 py-3 text-center">
            <p className="text-xs text-gray-500">
              The structured Report Card is being wired up next — for now the coach works directly from your transcript.
            </p>
          </div>
        )}

        <div className="mt-6">
          <CoachConversation negotiationId={n.id} initialMessages={messages} canCoach={canCoach} />
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#e5e3df] bg-white p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{value}</p>
    </div>
  )
}
