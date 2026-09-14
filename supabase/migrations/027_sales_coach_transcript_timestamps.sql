-- ============================================================
-- 027: Sales Coach — clickable transcript timestamps
-- ============================================================
-- Idempotent — safe to re-run.
--
-- AssemblyAI returns per-utterance start/end times (ms). Until now only the
-- flattened "Speaker A: ..." text was kept, so nothing in the UI could seek
-- the audio to the moment a line was actually said. This column holds the
-- structured segments (speaker, start_ms, end_ms, text) for the AssemblyAI
-- path only — a pasted transcript has no audio to seek into, so it stays
-- NULL for those rows and the UI falls back to plain text.
ALTER TABLE public.sales_coach_negotiations
    ADD COLUMN IF NOT EXISTS system_transcript_segments JSONB;

COMMENT ON COLUMN public.sales_coach_negotiations.system_transcript_segments IS
    'Array of {speaker, start_ms, end_ms, text} from AssemblyAI diarization, in order. NULL for a pasted transcript (no audio to seek into) or a row transcribed before this column existed.';
