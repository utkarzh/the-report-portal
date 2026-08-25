import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'
import { canTransition } from '@/lib/finance-caja'

interface Params { params: { cajaId: string } }

export async function POST(_request: Request, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: caja } = await supabaseAdmin.from('finance_cajas').select('*').eq('id', params.cajaId).single()
  if (!caja) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canTransition(caja.stage, 'closed')) {
    return NextResponse.json({ error: `Cannot close from stage "${caja.stage}".` }, { status: 409 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('finance_cajas').update({ stage: 'closed' }).eq('id', params.cajaId).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('finance_caja_events').insert({ caja_id: params.cajaId, from_stage: caja.stage, to_stage: 'closed', actor_id: profile.id })
  return NextResponse.json({ caja: updated })
}
