import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'
import { canTransition } from '@/lib/finance-caja'
import { emailIncidentOpened } from '@/lib/finance-email'
import { getBaseUrl } from '@/lib/url'

interface Params { params: { cajaId: string } }

// POST /api/finance/cajas/[cajaId]/incidents — brief G-01: "open an incident
// against a specific receipt or line so that corrections are tracked, not
// lost in chat." Moves the caja under_review → incidents and notifies the
// director (brief G-02).
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { description, requiredAction, dueDate, expenseId } = await request.json()
  if (!description?.trim() || !requiredAction?.trim()) {
    return NextResponse.json({ error: 'A description and required action are required.' }, { status: 400 })
  }

  const { data: caja } = await supabaseAdmin.from('finance_cajas').select('*').eq('id', params.cajaId).single()
  if (!caja) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: incident, error } = await supabaseAdmin
    .from('finance_incidents')
    .insert({
      caja_id: params.cajaId,
      expense_id: expenseId || null,
      description: description.trim(),
      required_action: requiredAction.trim(),
      due_date: dueDate || null,
      created_by: profile.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (canTransition(caja.stage, 'incidents')) {
    await supabaseAdmin.from('finance_cajas').update({ stage: 'incidents' }).eq('id', params.cajaId)
    await supabaseAdmin.from('finance_caja_events').insert({ caja_id: params.cajaId, from_stage: caja.stage, to_stage: 'incidents', actor_id: profile.id, comment: description.trim() })
  }

  const { data: director } = await supabaseAdmin
    .from('finance_project_members')
    .select('user_id, profiles!finance_project_members_user_id_fkey(email)')
    .eq('project_id', caja.project_id)
    .eq('project_role', 'director')
    .maybeSingle<{ user_id: string; profiles: { email: string } | null }>()
  if (director) {
    await supabaseAdmin.from('finance_notifications').insert({
      user_id: director.user_id,
      type: 'incident_opened',
      message: `New incident on week ${caja.week_number}: ${description.trim()}`,
      link: `/finance/cajas/${params.cajaId}`,
    })
    if (director.profiles?.email) {
      const { data: project } = await supabaseAdmin.from('finance_projects').select('name').eq('id', caja.project_id).single()
      await emailIncidentOpened(getBaseUrl(request), director.profiles.email, project?.name || 'Project', caja.week_number, description.trim(), params.cajaId)
    }
  }

  return NextResponse.json({ incident }, { status: 201 })
}
