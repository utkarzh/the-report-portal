import { supabaseAdmin } from '@/lib/supabase/admin'

// Document generation streams from Claude and persists status:'complete' + the
// output only at the very end. On serverless, a client disconnect can kill the
// function before that final write runs — leaving the row stuck at 'generating'
// (sometimes with the finished output already saved from a prior run, sometimes
// with nothing). This heals such a row on page load, independent of any tab:
//
//   • output present  → the run really produced a document → mark 'complete'.
//   • no output, stale → the run is dead and unrecoverable   → mark 'failed'
//     (so the UI offers "generate" again instead of spinning forever).
//   • no output, fresh → might still be running → leave as 'generating'.
//
// Returns the (possibly updated) status so the caller can render accordingly.
const STALE_MS = 5 * 60 * 1000 // 5 min — safely longer than a real generation

export async function reconcileDocumentStatus(row: {
  id: string
  status: string
  output: string | null
  updated_at: string
}): Promise<string> {
  if (row.status !== 'generating') return row.status

  if (row.output && row.output.trim()) {
    await supabaseAdmin.from('document_sessions').update({ status: 'complete' }).eq('id', row.id)
    return 'complete'
  }

  const age = Date.now() - new Date(row.updated_at).getTime()
  if (age > STALE_MS) {
    await supabaseAdmin.from('document_sessions').update({ status: 'failed' }).eq('id', row.id)
    return 'failed'
  }

  return 'generating'
}
