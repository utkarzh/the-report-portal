-- ============================================================
-- Add interview-question generation output to research_sessions.
-- Run this only if you've already applied 001_schema.sql.
-- Fresh setups already include this column.
-- ============================================================

ALTER TABLE public.research_sessions
    ADD COLUMN IF NOT EXISTS questions_output TEXT;
