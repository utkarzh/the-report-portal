import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { FinanceAttachment, FinanceFunding } from '@/types'

// Deletes stored files once nothing points at them any more — a funding
// attachment removed in "Edit funding", a withdrawn/removed ticket's receipt
// and rate proof, the old photo after "Replace photo" (client request, 26 Oct
// 2026: a deleted attachment must not stay in storage). A receipt photo can
// be shared by several tickets split from one shot, so each path is checked
// against every ticket, receipt row and funding first; a receipt row no ticket
// uses any more is removed with its file. Any failed check counts as "still
// in use" — a file is never deleted on a guess. Best-effort: the action that
// removed the reference has already succeeded.
export async function removeUnusedFinanceFiles(projectId: string, paths: (string | null | undefined)[]) {
  const candidates = Array.from(new Set(paths.filter((p): p is string => !!p && p.startsWith(`${projectId}/`))))
  if (candidates.length === 0) return
  try {
    const free: string[] = []
    for (const path of candidates) {
      const [asReceipt, asRateProof, receiptRows, asFundingFile, asFundingProof] = await Promise.all([
        supabaseAdmin.from('finance_expenses').select('id', { count: 'exact', head: true }).eq('receipt_file_path', path),
        supabaseAdmin.from('finance_expenses').select('id', { count: 'exact', head: true }).eq('exchange_rate_proof_path', path),
        supabaseAdmin.from('finance_receipts').select('id').eq('file_path', path),
        supabaseAdmin.from('finance_fundings').select('id', { count: 'exact', head: true }).contains('proof_files', [{ path }]),
        supabaseAdmin.from('finance_fundings').select('id', { count: 'exact', head: true }).eq('proof_image_path', path),
      ])
      if (asReceipt.error || asRateProof.error || receiptRows.error || asFundingFile.error || asFundingProof.error) continue
      if ((asReceipt.count ?? 0) + (asRateProof.count ?? 0) + (asFundingFile.count ?? 0) + (asFundingProof.count ?? 0) > 0) continue

      const rowIds = (receiptRows.data ?? []).map(r => r.id)
      if (rowIds.length > 0) {
        const { count: ticketsOnRows, error } = await supabaseAdmin
          .from('finance_expenses').select('id', { count: 'exact', head: true }).in('receipt_id', rowIds)
        if (error || (ticketsOnRows ?? 0) > 0) continue
        const { error: rowError } = await supabaseAdmin.from('finance_receipts').delete().in('id', rowIds)
        if (rowError) continue
      }
      free.push(path)
    }
    if (free.length > 0) {
      const { error } = await supabaseAdmin.storage.from('finance-receipts').remove(free)
      if (error) console.error('Removing unused finance files failed:', error.message)
    }
  } catch (err) {
    console.error('Removing unused finance files failed (non-blocking):', err)
  }
}

export type SignedAttachment = FinanceAttachment & { url: string | null }

// Short-lived signed links for every evidence file on each funding, so both
// ledgers can open them in place (private bucket). Falls back to the single
// proof_image_path for a row read before migration 042 added proof_files.
// Pass the request-scoped client on pages that rely on storage RLS (project
// members can read their own project's folder), supabaseAdmin in routes that
// have already checked access.
export async function signFundingAttachments<T extends Pick<FinanceFunding, 'proof_image_path'> & { proof_files?: FinanceAttachment[] | null }>(
  client: Pick<SupabaseClient, 'storage'>,
  fundings: T[],
): Promise<(T & { attachments: SignedAttachment[] })[]> {
  return Promise.all(fundings.map(async (f) => {
    const files: FinanceAttachment[] = f.proof_files?.length
      ? f.proof_files
      : f.proof_image_path ? [{ path: f.proof_image_path, name: 'Evidence' }] : []
    const attachments = await Promise.all(files.map(async (file) => {
      const { data } = await client.storage.from('finance-receipts').createSignedUrl(file.path, 3600)
      return { ...file, url: data?.signedUrl ?? null }
    }))
    return { ...f, attachments }
  }))
}
