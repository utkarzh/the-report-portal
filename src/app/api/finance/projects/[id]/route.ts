import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess, requireFinanceAdmin } from '@/lib/finance-auth'
import { recordHistory, type HistoryEntry } from '@/lib/finance-history'
import { refreshConversionFlags } from '@/lib/finance-review'
import { isFinanceAdmin } from '@/lib/access'
import { computeBalance, spendByCategory } from '@/lib/finance'
import { loadExpenseComments } from '@/lib/finance-comments'
import { signFundingAttachments } from '@/lib/finance-attachments'
import { projectWeekAnchor } from '@/lib/finance-weeks'

interface Params {
  params: { id: string }
}

// GET /api/finance/projects/[id] — full detail for the field project
// dashboard and the finance-admin project page: project row, team, funding
// ledger, expenses and the computed balance/category breakdown.
export async function GET(request: Request, { params }: Params) {
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

  const { data: project, error } = await supabaseAdmin
    .from('finance_projects')
    .select('*')
    .eq('id', params.id)
    .single()
  if (error || !project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: members } = await supabaseAdmin
    .from('finance_project_members')
    .select('id, user_id, project_role, created_at, profiles!finance_project_members_user_id_fkey(full_name, email)')
    .eq('project_id', params.id)
    .order('project_role')

  const { data: rawFundings } = await supabaseAdmin
    .from('finance_fundings')
    .select('*, profiles!finance_fundings_recorded_by_fkey(full_name, email)')
    .eq('project_id', params.id)
    .order('date_sent', { ascending: true })
  const fundings = await signFundingAttachments(supabaseAdmin, rawFundings ?? [])

  const { data: rawExpenses } = await supabaseAdmin
    .from('finance_expenses')
    .select('*, finance_expense_flags(*), finance_receipts(file_path)')
    .eq('project_id', params.id)
    .order('expense_date', { ascending: false })

  // Signed URLs so the ledger can show the receipt (and, if present, the
  // optional exchange-rate proof photo) beside each line without a second
  // round trip per row — and each ticket's comment thread (migration 042).
  const commentsByExpense = await loadExpenseComments(supabaseAdmin, (rawExpenses ?? []).map(e => e.id))
  const expenses = await Promise.all((rawExpenses ?? []).map(async (e) => {
    const path = e.finance_receipts?.file_path || e.receipt_file_path
    const receiptUrl = path ? (await supabaseAdmin.storage.from('finance-receipts').createSignedUrl(path, 3600)).data?.signedUrl ?? null : null
    const exchangeRateProofUrl = e.exchange_rate_proof_path
      ? (await supabaseAdmin.storage.from('finance-receipts').createSignedUrl(e.exchange_rate_proof_path, 3600)).data?.signedUrl ?? null
      : null
    return { ...e, receiptUrl, exchangeRateProofUrl, comments: commentsByExpense[e.id] ?? [] }
  }))

  const { data: transfersIn } = await supabaseAdmin.from('finance_transfers').select('*').eq('to_project_id', params.id)
  const { data: transfersOut } = await supabaseAdmin.from('finance_transfers').select('*').eq('from_project_id', params.id)

  return NextResponse.json({
    project,
    members: members ?? [],
    fundings,
    expenses,
    transfersIn: transfersIn ?? [],
    transfersOut: transfersOut ?? [],
    ...computeBalance(fundings, expenses, transfersIn ?? [], transfersOut ?? []),
    categorySpend: spendByCategory(expenses),
    // Week 1 = the Monday–Sunday week of the first receipt or funds (see
    // finance-weeks.ts) — the ledger, export and caja screens all count from it.
    weekAnchor: projectWeekAnchor(project.created_at, expenses, fundings),
  })
}

// PATCH /api/finance/projects/[id] — finance admin updates the project:
//   - exchangeRate: the default rate (brief B-01: "exchange rate (editable)").
//     Only affects tickets logged from now on — every logged ticket keeps its
//     own snapshotted exchange_rate_used, matching the brief's rule that the
//     rate in force at the time is preserved.
//   - reconvertRates: Finance's correction for tickets logged at a wrong
//     rate (e.g. Jamaica's inverted 0.0063, client review 26 Oct 2026). The
//     PENDING tickets in the project's local currency whose rate is one of
//     these are re-converted at the project rate (the new one when
//     exchangeRate is sent too, else the current one) — so it also works
//     after the project rate was already corrected on its own, which is
//     exactly what happened on Jamaica. Verified and rejected tickets are
//     never touched. Each re-conversion is written to the history with its
//     old and new amounts. (reconvertPending, from the first version, means
//     "the old project rate".)
//   - aiRules: only affects receipts read from now on.
//   - status 'closed' | 'active': closing makes the project read-only for
//     everyone and takes it out of the overview and backlog; reopening
//     undoes that. A closed project accepts nothing but reopening.
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: current } = await supabaseAdmin.from('finance_projects').select('*').eq('id', params.id).single()
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { exchangeRate, aiRules, status, reconvertPending, reconvertRates } = await request.json()
  const update: Record<string, unknown> = {}

  if (status !== undefined) {
    if (status !== 'active' && status !== 'closed') return NextResponse.json({ error: 'Status must be active or closed.' }, { status: 400 })
    update.status = status
  }
  const stillClosed = current.status === 'closed' && update.status !== 'active'
  const ratesToFix: number[] = Array.isArray(reconvertRates)
    ? reconvertRates.map(Number).filter(r => Number.isFinite(r) && r > 0)
    : reconvertPending ? [Number(current.exchange_rate)] : []
  if (stillClosed && (exchangeRate !== undefined || aiRules !== undefined || ratesToFix.length > 0)) {
    return NextResponse.json({ error: 'This project is closed. Reopen it to make changes.' }, { status: 409 })
  }

  if (exchangeRate !== undefined) {
    const rate = Number(exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json({ error: 'Exchange rate must be a positive number.' }, { status: 400 })
    }
    update.exchange_rate = rate
  }

  if (aiRules !== undefined) {
    update.ai_rules = String(aiRules).trim()
  }

  if (Object.keys(update).length === 0 && ratesToFix.length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { data: project, error } = Object.keys(update).length > 0
    ? await supabaseAdmin.from('finance_projects').update(update).eq('id', params.id).select('*').single()
    : { data: current, error: null }

  if (error || !project) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })

  const history: HistoryEntry[] = []
  const projectEntry = (action: string, changes: HistoryEntry['changes']) =>
    history.push({ projectId: project.id, entityType: 'project', entityId: project.id, action, actor: profile, changes })
  if (update.status !== undefined && update.status !== current.status) {
    projectEntry(update.status === 'closed' ? 'closed' : 'reopened', { status: { from: current.status, to: update.status } })
  }
  if (update.exchange_rate !== undefined && Number(update.exchange_rate) !== Number(current.exchange_rate)) {
    projectEntry('rate_changed', { exchange_rate: { from: current.exchange_rate, to: update.exchange_rate } })
  }
  if (update.ai_rules !== undefined && update.ai_rules !== current.ai_rules) {
    projectEntry('rules_changed', { ai_rules: { from: current.ai_rules, to: update.ai_rules } })
  }

  let reconverted = 0
  const newRate = Number(project.exchange_rate)
  const fixSet = new Set(ratesToFix.filter(r => r !== newRate))
  if (fixSet.size > 0) {
    const localCurrency = (project.local_currency || '').toUpperCase()
    const { data: pending } = await supabaseAdmin
      .from('finance_expenses')
      .select('*')
      .eq('project_id', project.id)
      .eq('status', 'pending')
    const targets = (pending ?? []).filter(x =>
      fixSet.has(Number(x.exchange_rate_used)) && (!localCurrency || (x.local_currency || '').toUpperCase() === localCurrency))
    for (const e of targets) {
      const settlement = Math.round((Number(e.local_amount) / newRate) * 100) / 100
      const { data: fixed, error: fixError } = await supabaseAdmin
        .from('finance_expenses')
        .update({ exchange_rate_used: newRate, settlement_amount: settlement })
        .eq('id', e.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle()
      if (fixError || !fixed) continue
      reconverted++
      history.push({
        projectId: project.id, entityType: 'expense', entityId: e.id, action: 'reconverted', actor: profile,
        changes: {
          exchange_rate_used: { from: e.exchange_rate_used, to: newRate },
          settlement_amount: { from: e.settlement_amount, to: settlement },
        },
        note: `Re-converted from ${e.exchange_rate_used} to the project rate ${newRate}`,
      })
      await refreshConversionFlags(fixed, project)
    }
  }

  await recordHistory(history)
  return NextResponse.json({ project, reconverted })
}

// DELETE /api/finance/projects/[id] — { confirmName } — permanently deletes a
// project and everything in it (client request, 28 Oct 2026: clear out old
// test projects). Closing stays the archive; deleting is only offered once a
// project is closed, so a live project can't go by mistake, and the caller
// must send the project's exact name.
//   - Refused while a transfer links it to another project: transfers cascade
//     with either side, so deleting this one would silently change the other
//     project's balance.
//   - Tickets, receipts, funds, team, cajas and comment threads go with the
//     project row (all ON DELETE CASCADE). Its money history (no foreign key,
//     append-only) is kept, with a final "deleted" entry recording what was
//     removed.
//   - Its notifications and every stored file under its folder (receipts,
//     rate proofs, funding evidence, abandoned uploads) are removed too.
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAdmin()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: project } = await supabaseAdmin.from('finance_projects').select('*').eq('id', params.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.status !== 'closed') {
    return NextResponse.json({ error: 'Close the project before deleting it.' }, { status: 409 })
  }
  const { confirmName } = await request.json().catch(() => ({}))
  if (typeof confirmName !== 'string' || confirmName.trim() !== String(project.name).trim()) {
    return NextResponse.json({ error: 'Type the project name exactly to confirm.' }, { status: 400 })
  }

  const { data: transfers, error: transferError } = await supabaseAdmin
    .from('finance_transfers')
    .select('from_project_id, to_project_id')
    .or(`from_project_id.eq.${project.id},to_project_id.eq.${project.id}`)
  if (transferError) return NextResponse.json({ error: transferError.message }, { status: 500 })
  if ((transfers ?? []).length > 0) {
    const otherIds = Array.from(new Set((transfers ?? []).map(t => t.from_project_id === project.id ? t.to_project_id : t.from_project_id)))
    const { data: others } = await supabaseAdmin.from('finance_projects').select('name').in('id', otherIds)
    const names = (others ?? []).map(o => o.name).join(', ') || 'another project'
    return NextResponse.json({
      error: `This project has transfers with ${names}. Deleting it would change ${otherIds.length === 1 ? 'that project\'s' : 'those projects\''} balance, so it can't be deleted.`,
    }, { status: 409 })
  }

  const [{ data: expenses }, { data: fundings }, { data: cajas }] = await Promise.all([
    supabaseAdmin.from('finance_expenses').select('status, settlement_amount').eq('project_id', project.id),
    supabaseAdmin.from('finance_fundings').select('amount').eq('project_id', project.id),
    supabaseAdmin.from('finance_cajas').select('id').eq('project_id', project.id),
  ])
  const tickets = expenses ?? []
  const verifiedTotal = tickets.filter(e => e.status === 'verified').reduce((s, e) => s + Number(e.settlement_amount), 0)
  const fundsTotal = (fundings ?? []).reduce((s, f) => s + Number(f.amount), 0)

  const { error } = await supabaseAdmin.from('finance_projects').delete().eq('id', project.id).eq('status', 'closed')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const money = (n: number) => `${project.settlement_currency} ${n.toFixed(2)}`
  await recordHistory({
    projectId: project.id, entityType: 'project', entityId: project.id, action: 'deleted', actor: profile,
    changes: { name: { from: project.name, to: null } },
    note: `Deleted with ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} (${money(verifiedTotal)} verified) and ${(fundings ?? []).length} funding${(fundings ?? []).length === 1 ? '' : 's'} (${money(fundsTotal)}).`,
  })

  // Notifications link to the project page or to one of its cajas.
  const linkFilters = [`link.like.%${project.id}%`, ...(cajas ?? []).map(c => `link.like.%${c.id}%`)]
  const { error: notifError } = await supabaseAdmin.from('finance_notifications').delete().or(linkFilters.join(','))
  if (notifError) console.error('Deleting a finance project\'s notifications failed:', notifError.message)

  await removeProjectFolder(project.id)
  return NextResponse.json({ deleted: true })
}

// Every file a project ever stored sits flat under "<project id>/" in the
// finance-receipts bucket. Best-effort: the project is already gone.
async function removeProjectFolder(projectId: string) {
  try {
    const bucket = supabaseAdmin.storage.from('finance-receipts')
    for (;;) {
      const { data, error } = await bucket.list(projectId, { limit: 1000 })
      if (error) { console.error('Listing a deleted project\'s files failed:', error.message); return }
      const paths = (data ?? []).filter(f => f.id).map(f => `${projectId}/${f.name}`)
      if (paths.length === 0) return
      const { error: removeError } = await bucket.remove(paths)
      if (removeError) { console.error('Removing a deleted project\'s files failed:', removeError.message); return }
      if (paths.length < 1000) return
    }
  } catch (err) {
    console.error('Removing a deleted project\'s files failed (non-blocking):', err)
  }
}
