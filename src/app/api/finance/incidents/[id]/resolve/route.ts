import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'
import { canTransition } from '@/lib/finance-caja'

interface Params { params: { id: string } }

// POST /api/finance/incidents/[id]/resolve — brief G-01: "resolving all open
// incidents moves the caja back to Resubmitted automatically."
export async function POST(_request: Request, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: incident, error } = await supabaseAdmin
    .from('finance_incidents')
    .update({ status: 'resolved' })
    .eq('id', params.id)
    .select('*, finance_cajas(*)')
    .single()

  if (error || !incident) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })

  const { count: openCount } = await supabaseAdmin
    .from('finance_incidents')
    .select('id', { count: 'exact', head: true })
    .eq('caja_id', incident.caja_id)
    .eq('status', 'open')

  if ((openCount ?? 0) === 0) {
    const caja = incident.finance_cajas
    if (canTransition(caja.stage, 'resubmitted')) {
      await supabaseAdmin.from('finance_cajas').update({ stage: 'resubmitted' }).eq('id', caja.id)
      await supabaseAdmin.from('finance_caja_events').insert({ caja_id: caja.id, from_stage: caja.stage, to_stage: 'resubmitted', actor_id: profile.id, comment: 'All incidents resolved' })
    }
  }

  return NextResponse.json({ incident })
}
