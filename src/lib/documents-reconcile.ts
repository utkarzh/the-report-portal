import { supabaseAdmin } from '@/lib/supabase/admin'

// Documents are generated in chunks: each chunk persists progress and the final
// chunk sets status:'complete'. A row can therefore be legitimately 'generating'
// with PARTIAL output in between chunks — so we must NOT treat "has output" as
// "done" (that would prematurely finalise an in-progress doc). The client resumes
// the chunk loop whenever it opens a 'generating' row.
//
// This heals only the genuinely-dead case: a run that produced NOTHING and has
// gone stale (client vanished before the first chunk landed). Those are marked
// 'failed' so the UI offers a fresh "Generate" instead of spinning forever.
// A stale row WITH partial output is left as 'generating' so reopening resumes it.
const STALE_MS = 5 * 60 * 1000 // 5 min — safely longer than one chunk

export async function reconcileDocumentStatus(row: {
  id: string
  status: string
  output: string | null
  updated_at: string
}): Promise<string> {
  if (row.status !== 'generating') return row.status

  const hasOutput = Boolean(row.output && row.output.trim())
  const age = Date.now() - new Date(row.updated_at).getTime()

  // Dead run, nothing produced, and no chunk has landed in a while → failed.
  if (!hasOutput && age > STALE_MS) {
    await supabaseAdmin.from('document_sessions').update({ status: 'failed' }).eq('id', row.id)
    return 'failed'
  }

  // Otherwise leave it generating — the client resumes chunking on open.
  return 'generating'
}
