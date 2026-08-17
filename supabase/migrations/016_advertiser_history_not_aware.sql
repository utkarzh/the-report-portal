-- ============================================================
-- 016 — Advertiser history "Not aware" option (Commercial Meeting Preparation)
-- ============================================================
-- Run this on an EXISTING database created from an earlier 001/014.
-- Idempotent / safe to re-run. Merged into 001_schema.sql for fresh installs.
--
-- The advertiser-history question on the meeting-prep intake form was
-- previously a mandatory yes/no. Reps often genuinely don't know whether
-- their company has advertised with TRC before (no tracker entry, no
-- personal knowledge), and were being forced to guess "No" just to submit
-- the form. This adds a third 'not_aware' value and the form no longer
-- requires an answer — it defaults to 'not_aware' when left blank.
-- ============================================================

ALTER TABLE public.meeting_prep_sessions
    DROP CONSTRAINT IF EXISTS meeting_prep_sessions_advertiser_history_status_check;

ALTER TABLE public.meeting_prep_sessions
    ADD CONSTRAINT meeting_prep_sessions_advertiser_history_status_check
    CHECK (advertiser_history_status IN ('yes', 'no', 'not_aware'));
