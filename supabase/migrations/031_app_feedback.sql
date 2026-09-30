-- ============================================================
-- 031: APP FEEDBACK (reviews + bug reports)
-- ------------------------------------------------------------
-- Idempotent. Safe to re-run.
--
-- Lets any signed-in user tell the team how the app is working for them —
-- a lightweight sentiment review, or a bug report — from a floating,
-- entirely opt-in widget (see FeedbackWidget.tsx). Nothing is forced: there
-- is no popup-on-load and no "dismiss" tracking, because the widget never
-- appears uninvited in the first place. A user may submit any number of
-- times. Admins read everything at /admin/feedback.
--
-- user_email/user_name are denormalised (same reasoning as
-- login_audit_logs) so a submission stays legible after the author's
-- account is deleted — user_id is nullable + SET NULL, never CASCADE.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_feedback (
    id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
    user_email  TEXT          NOT NULL,
    user_name   TEXT,
    -- 'review' (general sentiment) | 'bug' (something broken)
    type        TEXT          NOT NULL CHECK (type IN ('review', 'bug')),
    -- 1-5, review only. NULL for bug reports (severity isn't rated).
    rating      SMALLINT      CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
    message     TEXT          NOT NULL,
    -- Path the user was on when they opened the widget — free context for
    -- triaging a bug report, captured client-side, never required.
    page_url    TEXT,
    -- 'new' | 'reviewed' — a single admin-side triage flag, nothing fancier.
    status      TEXT          NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed')),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_feedback_created_at ON public.app_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_feedback_type        ON public.app_feedback(type);
CREATE INDEX IF NOT EXISTS idx_app_feedback_status       ON public.app_feedback(status);
CREATE INDEX IF NOT EXISTS idx_app_feedback_user_id      ON public.app_feedback(user_id);

ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can submit own feedback" ON public.app_feedback;
CREATE POLICY "Users can submit own feedback"
    ON public.app_feedback FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own feedback" ON public.app_feedback;
CREATE POLICY "Users can view own feedback"
    ON public.app_feedback FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage feedback" ON public.app_feedback;
CREATE POLICY "Admins can manage feedback"
    ON public.app_feedback FOR ALL USING (public.user_role() = 'admin');
