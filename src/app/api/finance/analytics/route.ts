import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'

// GET /api/finance/analytics — brief H-01: spend by category/project/period.
// AI usage cost for this module (workflows finance_receipt_extraction and
// finance_audit_report) is logged to the shared usage_events ledger — see
// logUsageEvent calls in finance-ai.ts / finance-audit.ts — and surfaces in
// the platform-wide /admin/analytics page, not here. Finance users shouldn't
// see AI cost mixed into their spend numbers.
//
// Money is grouped by settlement currency: projects settle in USD or EUR,
// and adding the two together under "$" (as this used to) gives a number
// that means nothing — found 26 Oct 2026, "$9,581.14 outstanding" was really
// USD 8,171.16 + EUR 1,409.98.
export async function GET() {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error

  const { data: projects } = await supabaseAdmin.from('finance_projects').select('id, name, settlement_currency')
  const { data: expenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('project_id, category, settlement_amount, status, created_at')
  const { data: flags } = await supabaseAdmin.from('finance_expense_flags').select('expense_id')

  const projectById = new Map((projects ?? []).map(p => [p.id, p]))
  const byCurrency: Record<string, { totalVerifiedSpend: number; spendByCategory: Record<string, number>; spendByProject: Record<string, number> }> = {}
  for (const e of expenses ?? []) {
    if (e.status !== 'verified') continue
    const project = projectById.get(e.project_id)
    const currency = project?.settlement_currency || 'USD'
    const bucket = (byCurrency[currency] ??= { totalVerifiedSpend: 0, spendByCategory: {}, spendByProject: {} })
    const amount = Number(e.settlement_amount)
    bucket.totalVerifiedSpend += amount
    bucket.spendByCategory[e.category] = (bucket.spendByCategory[e.category] || 0) + amount
    const name = project?.name || 'Unknown'
    bucket.spendByProject[name] = (bucket.spendByProject[name] || 0) + amount
  }

  const flaggedExpenseIds = new Set((flags ?? []).map(f => f.expense_id))
  const receiptsProcessed = (expenses ?? []).length
  const flagRate = receiptsProcessed > 0 ? flaggedExpenseIds.size / receiptsProcessed : 0

  return NextResponse.json({
    byCurrency,
    receiptsProcessed,
    flaggedCount: flaggedExpenseIds.size,
    flagRate,
  })
}
