import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, SONNET_PRICING, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import { logUsageEvent } from '@/lib/claude/usage'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceCaja, FinanceExpense, FinanceExpenseFlag, FinanceAuditVerdict } from '@/types'

const AUDIT_MODEL = 'claude-sonnet-4-6'

export interface AuditResult {
  verdict: FinanceAuditVerdict
  report: string
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'pass_with_observations', 'review_required', 'high_risk'] },
    report: { type: 'string', description: 'The full audit report as markdown: completeness, amount/date/category accuracy, duplicates, weekend spend, daily budgets, cash reconciliation, then the verdict with a one-paragraph rationale.' },
  },
  required: ['verdict', 'report'],
  additionalProperties: false,
} as const

// Brief F-03: "an automated audit report with a clear verdict ... covers
// completeness, amount/date/category accuracy, duplicates, weekend spend,
// daily budgets, and cash reconciliation. Ends in one verdict."
//
// NOTE: this produces the audit report and verdict only — it does NOT
// generate the "official Excel" (F-04), which the brief requires to reuse
// TRC's real template with its existing formulas untouched. That template
// file hasn't been supplied; see docs/cashbox-requirements.md. The report
// generated here is exportable as a .docx via the existing document
// renderer once that's wired up, and upgrades to the real Excel export the
// moment TRC provides the template — nothing here needs to change to add it.
export async function generateAuditReport(
  caja: Pick<FinanceCaja, 'week_number' | 'week_start' | 'week_end' | 'cash_confirmed_amount'>,
  expenses: (FinanceExpense & { finance_expense_flags?: FinanceExpenseFlag[] })[],
  computedBalance: number,
  userId: string,
): Promise<AuditResult> {
  const lines = expenses.map(e => {
    const flags = (e.finance_expense_flags ?? []).filter(f => !f.resolved)
    return `- ${e.expense_date} · ${FINANCE_EXPENSE_CATEGORY_LABELS[e.category]} · ${e.concept} · ${e.settlement_amount} · status=${e.status}${flags.length ? ` · unresolved flags: ${flags.map(f => f.flag_type).join(', ')}` : ''}`
  }).join('\n')

  const cashDiff = caja.cash_confirmed_amount != null ? (Number(caja.cash_confirmed_amount) - computedBalance).toFixed(2) : null

  const system = `You are Finance's automated auditor for TRC's weekly field-expense caja process. Produce a rigorous but fair audit report for week ${caja.week_number} (${caja.week_start} to ${caja.week_end}).

Cover: completeness (every expense has the mandatory fields), amount/date/category accuracy, duplicate risk, weekend-dated spend, daily budget adherence (accommodation), and cash reconciliation (the director's confirmed cash on hand vs. the computed balance — a material mismatch is a serious finding).

Receipts are the source of truth — never assume the ledger is correct over a flagged discrepancy. End with exactly one verdict: pass (no issues), pass_with_observations (minor, non-blocking notes), review_required (a real question Finance must resolve), or high_risk (unresolved critical flags, a large cash mismatch, or a pattern of duplicates).`

  const submission = `Cash confirmed by director: ${caja.cash_confirmed_amount ?? 'not yet confirmed'}\nComputed balance: ${computedBalance.toFixed(2)}\nDifference: ${cashDiff ?? 'n/a'}\n\nExpenses this week:\n${lines || '(none)'}`

  const anthropic = getAnthropicClient()
  const message = await anthropic.messages.create({
    model: AUDIT_MODEL,
    max_tokens: 3000,
    system,
    messages: [{ role: 'user', content: submission }],
    output_config: { format: { type: 'json_schema', schema: AUDIT_SCHEMA } },
  })

  const usage = parseUsage(message.usage as unknown, 0)
  const promptTokens = totalPromptTokens(usage)
  await logUsageEvent({
    userId,
    workflow: 'finance_audit_report',
    model: AUDIT_MODEL,
    tokensInput: promptTokens,
    tokensOutput: usage.outputTokens,
    tokensTotal: promptTokens + usage.outputTokens,
    costUsd: calculateCost(usage, SONNET_PRICING),
  })

  const text = message.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  return JSON.parse(text) as AuditResult
}
