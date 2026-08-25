import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { canTransition } from '@/lib/finance-caja'
import { emailCajaSubmitted } from '@/lib/finance-email'
import { getBaseUrl } from '@/lib/url'

interface Params { params: { cajaId: string } }

// POST /api/finance/cajas/[cajaId]/submit — brief F-02: "submit is blocked
// until cash-count confirmation and all flags are resolved or justified —
// enforced server-side." Unresolved CRITICAL flags (duplicate, prior-approval
// required) block; informational/warning flags don't — those are exactly the
// ones the brief treats as "flag, don't block" (weekend spend, over-budget,
// low-confidence fields, suspected personal purchase).
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: caja } = await supabaseAdmin.from('finance_cajas').select('*').eq('id', params.cajaId).single()
  if (!caja) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!isFinanceAdmin(profile)) {
    const { data: membership } = await supabaseAdmin
      .from('finance_project_members')
      .select('project_role')
      .eq('project_id', caja.project_id)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (!membership || membership.project_role !== 'director') {
      return NextResponse.json({ error: 'Only the project Director can submit the caja.' }, { status: 403 })
    }
  }

  if (!canTransition(caja.stage, 'submitted')) {
    return NextResponse.json({ error: `Cannot submit from stage "${caja.stage}".` }, { status: 409 })
  }
  if (caja.cash_confirmed_amount == null) {
    return NextResponse.json({ error: 'Confirm cash on hand before submitting.' }, { status: 409 })
  }

  const { data: expenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('id, finance_expense_flags(severity, resolved)')
    .eq('project_id', caja.project_id)
    .gte('expense_date', caja.week_start)
    .lte('expense_date', caja.week_end)

  const unresolvedCritical = (expenses ?? []).some(e =>
    (e.finance_expense_flags ?? []).some((f: { severity: string; resolved: boolean }) => f.severity === 'crit' && !f.resolved),
  )
  if (unresolvedCritical) {
    return NextResponse.json({ error: 'One or more expenses this week have an unresolved critical flag (duplicate or prior-approval-required) — resolve those before submitting.' }, { status: 409 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('finance_cajas')
    .update({ stage: 'submitted', submitted_at: new Date().toISOString(), submitted_by: profile.id })
    .eq('id', params.cajaId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('finance_caja_events').insert({ caja_id: params.cajaId, from_stage: caja.stage, to_stage: 'submitted', actor_id: profile.id })

  // Notify every finance admin — in-app (brief G-02) and by email, since a
  // submission is exactly the kind of low-frequency, high-signal event worth
  // an email (one caja, once a week, per project).
  const { data: admins } = await supabaseAdmin.from('profiles').select('id, email').eq('finance_role', 'finance_admin')
  const { data: project } = await supabaseAdmin.from('finance_projects').select('name').eq('id', caja.project_id).single()
  if (admins?.length) {
    await supabaseAdmin.from('finance_notifications').insert(
      admins.map(a => ({ user_id: a.id, type: 'caja_submitted', message: `Week ${caja.week_number} caja submitted for review.`, link: `/finance/cajas/${caja.id}` })),
    )
    await emailCajaSubmitted(getBaseUrl(request), admins.map(a => a.email).filter(Boolean), project?.name || 'Project', caja.week_number, caja.id)
  }

  return NextResponse.json({ caja: updated })
}
