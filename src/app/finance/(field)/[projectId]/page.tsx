export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Wallet, Lock } from 'lucide-react'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { computeBalance, spendByCategory } from '@/lib/finance'
import { loadExpenseComments } from '@/lib/finance-comments'
import { signFundingAttachments } from '@/lib/finance-attachments'
import { formatSignedAmount } from '@/lib/finance-ledger'
import { projectWeekAnchor } from '@/lib/finance-weeks'
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
  const { data: membership } = await supabase
    .from('finance_project_members')
    .select('project_role')
    .eq('project_id', project.id)
    .eq('user_id', profile.id)
    .maybeSingle()
  const isDirector = membership?.project_role === 'director'

  const rawExpenses = (expenses ?? []) as (FinanceExpense & {
    finance_receipts: { file_path: string } | null
    finance_expense_flags: FinanceExpenseFlag[]
  })[]
  const expenseList = rawExpenses as FinanceExpense[]
  // Funding evidence is shown to the field team too (several files per
  // funding since migration 042) — signed with the request-scoped client, so
  // storage RLS decides, same as the receipts below.
  const fundingList = await signFundingAttachments(
    supabase,
    (fundings ?? []) as (FinanceFunding & { profiles: { full_name: string | null; email: string } | null })[],
  )
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
  const commentsByExpense = await loadExpenseComments(supabase, rawExpenses.map(e => e.id))
  const expensesWithReceipts = await Promise.all(
    rawExpenses.map(async (e) => {
      const path = e.finance_receipts?.file_path || e.receipt_file_path
      const receiptUrl = path ? (await supabase.storage.from('finance-receipts').createSignedUrl(path, 3600)).data?.signedUrl ?? null : null
      const exchangeRateProofUrl = e.exchange_rate_proof_path
        ? (await supabase.storage.from('finance-receipts').createSignedUrl(e.exchange_rate_proof_path, 3600)).data?.signedUrl ?? null
        : null
      return { ...e, receiptUrl, exchangeRateProofUrl, comments: commentsByExpense[e.id] ?? [] }
    }),
  )
  const pendingCount = rawExpenses.filter(e => e.status === 'pending').length
  // Closed by Finance: read-only — no uploads, fixes or replies (the API
  // refuses them too).
  const closed = project.status === 'closed'

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
        {!closed && (
          <div className="flex items-center gap-2 flex-wrap">
            <FieldProjectActions
              projectId={project.id}
              settlementCurrency={project.settlement_currency}
              defaultExchangeRate={Number(project.exchange_rate)}
              localCurrency={project.local_currency}
            />
          </div>
        )}
      </div>

      {closed && (
        <div className="flex items-center gap-2 text-sm text-gray-700 bg-gray-100 border border-[#e5e3df] rounded-xl px-4 py-3 mb-6">
          <Lock size={14} className="text-gray-500 flex-shrink-0" />
          Finance has closed this project. Everything stays visible, but nothing new can be logged or changed.
        </div>
      )}

      <NeedsAttentionSection
        settlementCurrency={project.settlement_currency}
        rejectedExpenses={expensesWithReceipts.filter(e => e.status === 'rejected')}
        currentUserId={profile.id}
        isDirector={isDirector}
        readOnly={closed}
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
        {/* What the balance would be once every ticket still awaiting review
            is approved — an estimate, so deliberately quieter than the
            confirmed figure above (client request, Oct 2026). */}
        {pendingCount > 0 && (
          <div className="text-sm text-gray-500 mt-1 tabular-nums">
            Estimated{' '}
            <span className={`font-medium ${balance - pendingSpend < 0 ? 'text-red-600' : 'text-gray-700'}`}>
              {formatSignedAmount(currencySymbol, balance - pendingSpend)}
            </span>
            {' '}if all {pendingCount} pending ticket{pendingCount === 1 ? ' is' : 's are'} approved
          </div>
        )}
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
        settlementCurrency={project.settlement_currency}
        weekAnchor={projectWeekAnchor(project.created_at, expenseList, fundingList)}
        currentUserId={profile.id}
        isDirector={isDirector}
        readOnly={closed}
      />
    </div>
  )
}
