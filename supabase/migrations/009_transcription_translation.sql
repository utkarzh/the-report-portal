-- 009_transcription_translation.sql
-- Adds a single translation slot to each transcription.
--
-- Users can translate the RAW transcript into one of a fixed set of languages
-- (English, German, Spanish, Italian, Russian). Only ONE translation is kept per
-- transcription — re-translating overwrites it. The translation is independent
-- of refining: raw, translated, and refined are all stored side by side.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.transcriptions
    ADD COLUMN IF NOT EXISTS translated_transcript TEXT,
    ADD COLUMN IF NOT EXISTS translation_language  TEXT;

COMMENT ON COLUMN public.transcriptions.translated_transcript IS
    'Translation of the raw transcript (single slot; overwritten on re-translate).';
COMMENT ON COLUMN public.transcriptions.translation_language IS
    'Target language of translated_transcript, e.g. "German". NULL when not translated.';
