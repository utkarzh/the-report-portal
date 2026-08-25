export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Wallet } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { computeBalance, spendByCategory } from '@/lib/finance'
import FieldProjectActions from '@/components/finance/FieldProjectActions'
import NeedsAttentionSection from '@/components/finance/NeedsAttentionSection'
import FieldExpensesSection from '@/components/finance/FieldExpensesSection'
import type { FinanceExpense, FinanceExpenseFlag, FinanceFunding, FinanceTransfer } from '@/types'

interface Props {
  params: { projectId: string }
}

export default async function FieldProjectPage({ params }: Props) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: project } = await supabase
    .from('finance_projects')
    .select('*')
    .eq('id', params.projectId)
    .single()
  if (!project) notFound()

  const { data: fundings } = await supabase
    .from('finance_fundings')
    .select('*, profiles!finance_fundings_recorded_by_fkey(full_name, email)')
    .eq('project_id', project.id)
    .order('date_sent', { ascending: false })
  const { data: expenses } = await supabase
    .from('finance_expenses')
    .select('*, finance_receipts(file_path), finance_expense_flags(*)')
    .eq('project_id', project.id)
    .order('expense_date', { ascending: false })
  const { data: transfersIn } = await supabase.from('finance_transfers').select('*').eq('to_project_id', project.id)
  const { data: transfersOut } = await supabase.from('finance_transfers').select('*').eq('from_project_id', project.id)

  const rawExpenses = (expenses ?? []) as (FinanceExpense & {
    finance_receipts: { file_path: string } | null
    finance_expense_flags: FinanceExpenseFlag[]
  })[]
  const expenseList = rawExpenses as FinanceExpense[]
  const fundingList = (fundings ?? []) as (FinanceFunding & { profiles: { full_name: string | null; email: string } | null })[]
  const { balance, totalFunded, verifiedSpend, pendingSpend } = computeBalance(
    fundingList, expenseList, (transfersIn ?? []) as FinanceTransfer[], (transfersOut ?? []) as FinanceTransfer[],
  )
  const categorySpend = spendByCategory(expenseList)
  const currencySymbol = project.settlement_currency === 'USD' ? '$' : '€'

  // A field user should be able to see what they actually uploaded — not
  // just the extracted text — especially when it was rejected as illegible
  // or "looks fake" and they need to check what went wrong. The signed URL
  // is generated with the same request-scoped client used above (not the
  // service role), relying on the existing storage RLS that already lets any
  // project member read their own project's receipts (see migration 017).
  // The path can live on either finance_receipts.file_path (the newer,
  // dedicated-row model) or the older receipt_file_path column directly —
  // same fallback the admin review-queue route uses.
  const expensesWithReceipts = await Promise.all(
    rawExpenses.map(async (e) => {
      const path = e.finance_receipts?.file_path || e.receipt_file_path
      if (!path) return { ...e, receiptUrl: null as string | null }
      const { data: signed } = await supabase.storage.from('finance-receipts').createSignedUrl(path, 3600)
      return { ...e, receiptUrl: signed?.signedUrl ?? null }
    }),
  )

  return (
    <div className="p-8 max-w-5xl">
      <Link href="/finance" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 mb-3">
        <ArrowLeft size={13} /> My Projects
      </Link>
      <div className="mb-6 flex justify-between items-start flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{project.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {project.country} · settlement {project.settlement_currency} · rate {project.exchange_rate}
            {project.media_publication ? ` · ${project.media_publication}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FieldProjectActions
            projectId={project.id}
            settlementCurrency={project.settlement_currency}
          />
        </div>
      </div>

      <NeedsAttentionSection
        settlementCurrency={project.settlement_currency}
        rejectedExpenses={expensesWithReceipts.filter(e => e.status === 'rejected')}
      />

      {/* Balance is the one number a field user actually needs at a glance —
          a hero card, not a 4th-of-equal-weight stat tile. Mirrors the same
          "Current balance" treatment on the admin project page. */}
      <div className="bg-white border border-[#e5e3df] rounded-xl p-5 mb-8">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Wallet size={14} className="text-emerald-600" />
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Balance left</span>
        </div>
        <div className="text-4xl font-bold tabular-nums text-emerald-700">{currencySymbol}{balance.toFixed(2)}</div>
        <div className="text-xs text-gray-400 mt-2 tabular-nums">
          {currencySymbol}{verifiedSpend.toFixed(2)} verified spend · {currencySymbol}{totalFunded.toFixed(2)} funds received
        </div>
        {pendingSpend > 0 && (
          <div className="text-xs text-amber-700 mt-1.5 tabular-nums">
            {currencySymbol}{pendingSpend.toFixed(2)} pending review
          </div>
        )}
      </div>

      <FieldExpensesSection
        expenses={expensesWithReceipts}
        fundings={fundingList}
        transfersIn={(transfersIn ?? []) as FinanceTransfer[]}
        transfersOut={(transfersOut ?? []) as FinanceTransfer[]}
        categorySpend={categorySpend}
        currencySymbol={currencySymbol}
      />
    </div>
  )
}
