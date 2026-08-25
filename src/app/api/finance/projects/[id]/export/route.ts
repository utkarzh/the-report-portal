import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'
import { buildCajaWorkbook } from '@/lib/finance-excel'

interface Params { params: { id: string } }

// GET /api/finance/projects/[id]/export?weekStart=YYYY-MM-DD&weekEnd=YYYY-MM-DD&weekNumber=N
// Downloads the caja Excel for one week, matching the client's real template
// structure exactly (see finance-excel.ts). This is what her Excel headers
// requirement is actually about — a real .xlsx with real formulas, not a
// stage in some approval workflow.
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  if (!isFinanceAdmin(profile)) {
    const { data: membership } = await supabaseAdmin
      .from('finance_project_members')
      .select('id')
      .eq('project_id', params.id)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const weekStart = request.nextUrl.searchParams.get('weekStart')
  const weekEnd = request.nextUrl.searchParams.get('weekEnd')
  // "Week N" when the range matches one of the project's own weeks, "Custom"
  // otherwise — the client (ExportWeekModal) already worked this out against
  // the project's creation date; this route just labels the file with it.
  const label = request.nextUrl.searchParams.get('label') || 'Custom'
  if (!weekStart || !weekEnd) {
    return NextResponse.json({ error: 'weekStart and weekEnd are required.' }, { status: 400 })
  }

  const { data: project } = await supabaseAdmin.from('finance_projects').select('*').eq('id', params.id).single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: weekExpenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('*')
    .eq('project_id', params.id)
    .neq('status', 'rejected')
    .gte('expense_date', weekStart)
    .lte('expense_date', weekEnd)
    .order('expense_date')

  const { data: weekFundings } = await supabaseAdmin
    .from('finance_fundings')
    .select('amount')
    .eq('project_id', params.id)
    .gte('date_sent', weekStart)
    .lte('date_sent', weekEnd)

  // Carried forward = everything before this week: funds received minus
  // non-rejected expenses, up to (not including) weekStart.
  const { data: priorFundings } = await supabaseAdmin
    .from('finance_fundings')
    .select('amount')
    .eq('project_id', params.id)
    .lt('date_sent', weekStart)
  const { data: priorExpenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('settlement_amount, status')
    .eq('project_id', params.id)
    .neq('status', 'rejected')
    .lt('expense_date', weekStart)

  const carriedForward = (priorFundings ?? []).reduce((s, f) => s + Number(f.amount), 0)
    - (priorExpenses ?? []).reduce((s, e) => s + Number(e.settlement_amount), 0)
  const fundsReceivedThisWeek = (weekFundings ?? []).reduce((s, f) => s + Number(f.amount), 0)

  const buffer = await buildCajaWorkbook({
    project,
    weekLabel: label,
    weekStart,
    weekEnd,
    expenses: weekExpenses ?? [],
    carriedForward,
    fundsReceivedThisWeek,
  })

  const filename = `${project.name.replace(/[^a-z0-9]+/gi, '_')}_${label.replace(/[^a-z0-9]+/gi, '_')}_${weekStart}_to_${weekEnd}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
