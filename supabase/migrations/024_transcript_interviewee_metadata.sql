-- ============================================================
-- 024 — Transcript interviewee metadata (Name/Title/Company/Publication)
-- ============================================================
-- Run this on an EXISTING production database created from an earlier 001.
-- Fresh databases already have everything (merged into 001_schema.sql).
-- Idempotent and SAFE TO RE-RUN — uses IF NOT EXISTS throughout and never
-- drops or alters existing data.
--
-- Transcripts previously carried no interviewee metadata at all (just an
-- audio file and a free-text title) — there was nowhere to source the
-- standardised document header ("Interview Transcript / Name, Designation,
-- Company / For publication in Media") introduced for the Topic Outline,
-- Transcript, and Interview Request Letter exports. These four columns mirror
-- research_sessions' full_name/title_position/company_org/publication naming
-- for consistency, and are captured on the upload form (required) before a
-- transcription can start — see TranscriptionUploader.tsx.
-- ============================================================

ALTER TABLE public.transcriptions
    ADD COLUMN IF NOT EXISTS full_name      TEXT NOT NULL DEFAULT '';
ALTER TABLE public.transcriptions
    ADD COLUMN IF NOT EXISTS title_position TEXT NOT NULL DEFAULT '';
ALTER TABLE public.transcriptions
    ADD COLUMN IF NOT EXISTS company_org    TEXT NOT NULL DEFAULT '';
ALTER TABLE public.transcriptions
    ADD COLUMN IF NOT EXISTS publication    TEXT NOT NULL DEFAULT '';
