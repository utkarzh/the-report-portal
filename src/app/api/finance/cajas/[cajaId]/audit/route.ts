import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'
import { computeBalance } from '@/lib/finance'
import { generateAuditReport } from '@/lib/finance-audit'
import { canTransition } from '@/lib/finance-caja'
import { emailCajaReviewComplete } from '@/lib/finance-email'
import { getBaseUrl } from '@/lib/url'

interface Params { params: { cajaId: string } }

// POST /api/finance/cajas/[cajaId]/audit — brief F-03: runs the automated
// audit report and moves submitted → under_review. See finance-audit.ts for
// why this stops short of the official Excel export (F-04) — that needs
// TRC's real template, which hasn't been supplied yet.
//
// This is also the ONE moment Finance's ticket-by-ticket decisions (made on
// this same caja page, see the verify/reject actions there) get bundled into
// a single summary email to the director — the whole point being Finance
// checks a caja exactly once: tickets + the audit/Excel review together,
// not a running stream of individual approve/reject notifications.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: caja } = await supabaseAdmin.from('finance_cajas').select('*').eq('id', params.cajaId).single()
  if (!caja) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (caja.stage !== 'submitted' && caja.stage !== 'resubmitted') {
    return NextResponse.json({ error: `Cannot audit from stage "${caja.stage}".` }, { status: 409 })
  }

  const { data: expenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('*, finance_expense_flags(*)')
    .eq('project_id', caja.project_id)
    .gte('expense_date', caja.week_start)
    .lte('expense_date', caja.week_end)

  const { data: fundings } = await supabaseAdmin.from('finance_fundings').select('amount').eq('project_id', caja.project_id).lte('date_sent', caja.week_end)
  const { balance } = computeBalance(fundings ?? [], expenses ?? [])

  let result
  try {
    result = await generateAuditReport(caja, expenses ?? [], balance, profile.id)
  } catch (err) {
    console.error('Audit report generation failed:', err)
    return NextResponse.json({ error: 'Could not generate the audit report — try again shortly.' }, { status: 502 })
  }

  const fromStage = caja.stage
  const toStage = canTransition(fromStage, 'under_review') ? 'under_review' : fromStage

  const { data: updated, error } = await supabaseAdmin
    .from('finance_cajas')
    .update({ audit_verdict: result.verdict, audit_report: result.report, stage: toStage })
    .eq('id', params.cajaId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('finance_caja_events').insert({ caja_id: params.cajaId, from_stage: fromStage, to_stage: toStage, actor_id: profile.id, comment: `Audit verdict: ${result.verdict}` })

  const verifiedCount = (expenses ?? []).filter(e => e.status === 'verified').length
  const rejections = (expenses ?? [])
    .filter(e => e.status === 'rejected' && e.rejection_reason)
    .map(e => ({ concept: e.concept, reason: e.rejection_reason as string }))

  const { data: director } = await supabaseAdmin
    .from('finance_project_members')
    .select('profiles!finance_project_members_user_id_fkey(email)')
    .eq('project_id', caja.project_id)
    .eq('project_role', 'director')
    .maybeSingle<{ profiles: { email: string } | null }>()
  const { data: project } = await supabaseAdmin.from('finance_projects').select('name').eq('id', caja.project_id).single()

  if (director?.profiles?.email) {
    await emailCajaReviewComplete({
      baseUrl: getBaseUrl(request),
      to: director.profiles.email,
      projectName: project?.name || 'Project',
      weekNumber: caja.week_number,
      cajaId: caja.id,
      verifiedCount,
      rejections,
      auditVerdict: result.verdict,
    })
  }

  return NextResponse.json({ caja: updated })
}
