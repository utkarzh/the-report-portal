import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'
import { canTransition } from '@/lib/finance-caja'
import { emailCajaApproved } from '@/lib/finance-email'
import { getBaseUrl } from '@/lib/url'

interface Params { params: { cajaId: string } }

// POST /api/finance/cajas/[cajaId]/approve — brief rule #6: "no funds are
// released without a validated caja — a hard control, enforced server-side."
// Approval is that control; closing (a separate, later action) is archival.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: caja } = await supabaseAdmin.from('finance_cajas').select('*').eq('id', params.cajaId).single()
  if (!caja) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canTransition(caja.stage, 'approved')) {
    return NextResponse.json({ error: `Cannot approve from stage "${caja.stage}".` }, { status: 409 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('finance_cajas')
    .update({ stage: 'approved', approved_at: new Date().toISOString(), approved_by: profile.id })
    .eq('id', params.cajaId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('finance_caja_events').insert({ caja_id: params.cajaId, from_stage: caja.stage, to_stage: 'approved', actor_id: profile.id })

  const { data: director } = await supabaseAdmin
    .from('finance_project_members')
    .select('profiles!finance_project_members_user_id_fkey(email)')
    .eq('project_id', caja.project_id)
    .eq('project_role', 'director')
    .maybeSingle<{ profiles: { email: string } | null }>()
  if (director?.profiles?.email) {
    const { data: project } = await supabaseAdmin.from('finance_projects').select('name').eq('id', caja.project_id).single()
    await emailCajaApproved(getBaseUrl(request), director.profiles.email, project?.name || 'Project', caja.week_number, caja.id)
  }

  return NextResponse.json({ caja: updated })
}
