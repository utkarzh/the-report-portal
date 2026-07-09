import { supabaseAdmin } from '@/lib/supabase/admin'
import { getTranscript, formatSpeakerTranscript } from './client'

// Server-side safety net for the AssemblyAI async job model.
//
// AssemblyAI finishes transcripts asynchronously (often minutes later). The
// browser poll only writes the result to our DB *while the tab stays open* — so
// if the user navigates away before the job completes, the finished transcript
// is stranded on AssemblyAI and the row sits at 'transcribing' forever.
//
// This reconciles those rows without any open tab: for every 'transcribing' row
// that has an AssemblyAI job id, ask AssemblyAI and persist the result if it's
// done (or mark it failed on error). Call it on page loads (list + detail) so a
// stuck transcription heals the next time anyone looks at it.
//
// OpenAI-path rows have a NULL transcribe_job_id and are skipped, so this is a
// no-op for that provider.
export async function reconcilePendingTranscriptions(opts: { userId?: string; id?: string } = {}) {
  let query = supabaseAdmin
    .from('transcriptions')
    .select('id, transcribe_job_id')
    .eq('status', 'transcribing')
    .not('transcribe_job_id', 'is', null)

  if (opts.id) query = query.eq('id', opts.id)
  if (opts.userId) query = query.eq('user_id', opts.userId)

  const { data: rows } = await query
  if (!rows?.length) return

  await Promise.all(
    rows.map(async (r) => {
      try {
        const job = await getTranscript(r.transcribe_job_id as string)
        if (job.status === 'completed') {
          await supabaseAdmin
            .from('transcriptions')
            .update({ status: 'transcribed', raw_transcript: formatSpeakerTranscript(job), error: null })
            .eq('id', r.id)
        } else if (job.status === 'error') {
          await supabaseAdmin
            .from('transcriptions')
            .update({ status: 'failed', error: job.error || 'Transcription failed' })
            .eq('id', r.id)
        }
        // queued | processing → leave as-is; a later load will retry.
      } catch {
        // Transient AssemblyAI/network error — leave the row untouched so the
        // next page load reconciles it. Never block the page render on this.
      }
    }),
  )
}
