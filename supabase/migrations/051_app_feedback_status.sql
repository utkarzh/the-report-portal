-- ============================================================
-- 051: APP FEEDBACK STATUS (open / in progress / resolved / closed)
-- ------------------------------------------------------------
-- Idempotent. Safe to re-run. Needs 031.
--
-- "Report an issue" (sidebar + phone top bar, see ReportIssue.tsx) lets
-- every signed-in user, admins included, raise an issue and follow its
-- status under "My reports". Only admins see everyone's reports, at
-- /admin/feedback, and they move each one through:
--
--   new          shown as "Open"         waiting to be looked at
--   in_progress  shown as "In progress"  being worked on
--   resolved     shown as "Resolved"     fixed or done
--   closed       shown as "Closed"       no change planned
--
-- 031 only had new/reviewed. 'reviewed' meant "an admin has dealt with
-- it", so those rows become 'closed'. Until this runs the app still reads
-- 'reviewed' as Closed, and only setting a new status fails, with a
-- message naming this file.
--
-- status_updated_at: when the status last changed, so the reporter sees
-- "Resolved on 26 Nov". NULL until an admin first changes it.
-- ============================================================

ALTER TABLE public.app_feedback
    ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

ALTER TABLE public.app_feedback
    DROP CONSTRAINT IF EXISTS app_feedback_status_check;

UPDATE public.app_feedback SET status = 'closed' WHERE status = 'reviewed';

ALTER TABLE public.app_feedback
    ADD CONSTRAINT app_feedback_status_check
    CHECK (status IN ('new', 'in_progress', 'resolved', 'closed'));
