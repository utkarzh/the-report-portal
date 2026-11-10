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

// Signed links for many files in the private finance-receipts bucket at once.
// One Storage request per 100 paths, instead of one per file: a ledger of 150
// tickets (receipt + rate proof) used to make up to 300 requests on every page
// load. Pass the request-scoped client where storage RLS should decide, as with
// a single createSignedUrl. If a batch call fails outright, its paths are
// signed one by one, so a ledger never loses its links over this.
const SIGN_BATCH = 100

export async function signFinancePaths(
  client: Pick<SupabaseClient, 'storage'>,
  paths: (string | null | undefined)[],
  expiresIn = 3600,
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(paths.filter((p): p is string => !!p)))
  const urls = new Map<string, string | null>()
  const bucket = client.storage.from('finance-receipts')
  const batches: string[][] = []
  for (let i = 0; i < unique.length; i += SIGN_BATCH) batches.push(unique.slice(i, i + SIGN_BATCH))

  await Promise.all(batches.map(async (batch) => {
    const { data, error } = await bucket.createSignedUrls(batch, expiresIn)
    if (!error && data) {
      for (const item of data) {
        if (item.path) urls.set(item.path, item.error ? null : item.signedUrl ?? null)
      }
    }
    // Anything the batch didn't answer for (or a failed batch): one by one.
    const missing = batch.filter((p) => !urls.has(p))
    await Promise.all(missing.map(async (p) => {
      const single = await bucket.createSignedUrl(p, expiresIn)
      urls.set(p, single.data?.signedUrl ?? null)
    }))
  }))
  return urls
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
  const filesOf = (f: T): FinanceAttachment[] => f.proof_files?.length
    ? f.proof_files
    : f.proof_image_path ? [{ path: f.proof_image_path, name: 'Evidence' }] : []
  const urls = await signFinancePaths(client, fundings.flatMap((f) => filesOf(f).map((file) => file.path)))
  return fundings.map((f) => ({
    ...f,
    attachments: filesOf(f).map((file) => ({ ...file, url: urls.get(file.path) ?? null })),
  }))
}
