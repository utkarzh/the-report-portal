-- 007_assemblyai_transcription.sql
-- Adds support for the AssemblyAI transcription provider (speaker diarization).
--
-- AssemblyAI is an ASYNC job API: we submit the whole original file for one
-- transcript job (diarization needs the full recording so speaker labels stay
-- consistent) and poll it to completion. Unlike the OpenAI path, there is no
-- in-browser chunking. We store the AssemblyAI transcript id so polling and
-- resume-after-reload can find the in-flight job.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.transcriptions
    ADD COLUMN IF NOT EXISTS transcribe_job_id TEXT;

COMMENT ON COLUMN public.transcriptions.transcribe_job_id IS
    'Provider job id for async transcription (AssemblyAI transcript id). NULL for the synchronous/chunked OpenAI path.';
