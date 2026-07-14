-- ============================================================
-- 011: TOPIC OUTLINE for transcriptions
-- ------------------------------------------------------------
-- Idempotent. Safe to re-run.
--
-- An optional topic-outline document can be attached when the audio is
-- uploaded. Its extracted TEXT is stored here (the file itself isn't kept — we
-- only need the text) and passed to Claude as supporting context during refine,
-- to guide cleanup. The saved refining prompt remains the primary instruction;
-- the outline is secondary context.
-- ============================================================

ALTER TABLE public.transcriptions
    ADD COLUMN IF NOT EXISTS topic_outline          TEXT,
    ADD COLUMN IF NOT EXISTS topic_outline_filename TEXT;
