import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAdmin } from '@/lib/finance-auth'

// GET /api/finance/analytics — brief H-01: spend by category/project/period.
// AI usage cost for this module (workflows finance_receipt_extraction and
// finance_audit_report) is logged to the shared usage_events ledger — see
// logUsageEvent calls in finance-ai.ts / finance-audit.ts — and surfaces in
// the platform-wide /admin/analytics page, not here. Finance users shouldn't
// see AI cost mixed into their spend numbers.
export async function GET() {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error

  const { data: projects } = await supabaseAdmin.from('finance_projects').select('id, name')
  const { data: expenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('project_id, category, settlement_amount, status, created_at')
  const { data: flags } = await supabaseAdmin.from('finance_expense_flags').select('expense_id')

  const projectNameById = new Map((projects ?? []).map(p => [p.id, p.name]))
  const verified = (expenses ?? []).filter(e => e.status === 'verified')
  const totalVerifiedSpend = verified.reduce((s, e) => s + Number(e.settlement_amount), 0)

  const spendByCategory: Record<string, number> = {}
  for (const e of verified) spendByCategory[e.category] = (spendByCategory[e.category] || 0) + Number(e.settlement_amount)

  const spendByProject: Record<string, number> = {}
  for (const e of verified) {
    const name = projectNameById.get(e.project_id) || 'Unknown'
    spendByProject[name] = (spendByProject[name] || 0) + Number(e.settlement_amount)
  }

  const flaggedExpenseIds = new Set((flags ?? []).map(f => f.expense_id))
  const receiptsProcessed = (expenses ?? []).length
  const flagRate = receiptsProcessed > 0 ? flaggedExpenseIds.size / receiptsProcessed : 0

  return NextResponse.json({
    totalVerifiedSpend,
    receiptsProcessed,
    flaggedCount: flaggedExpenseIds.size,
    flagRate,
    spendByCategory,
    spendByProject,
  })
}
