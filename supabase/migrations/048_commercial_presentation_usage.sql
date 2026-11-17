-- ============================================================
-- 048 — Commercial Presentations: atomic usage totals
-- ============================================================
-- Run after 046. Idempotent and SAFE TO RE-RUN.
--
-- A Why [Country] Now run adds its tokens, searches and cost to the
-- presentation's running totals. Read-then-write in the app can drop one of
-- two runs that finish together, so the addition happens in one statement
-- here (same pattern as meeting_prep_add_usage() in 044). The app falls back
-- to read-then-write until this has run; the usage_events ledger (what
-- analytics reads) is exact either way.
-- ============================================================

DO $$
BEGIN
    IF to_regclass('public.commercial_presentations') IS NULL THEN
        RAISE EXCEPTION 'Run 046_commercial_presentations.sql before 048_commercial_presentation_usage.sql';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.commercial_presentation_add_usage(
    p_presentation UUID,
    p_tokens       INTEGER,
    p_web_searches INTEGER,
    p_cost         NUMERIC
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.commercial_presentations
       SET tokens_total = COALESCE(tokens_total, 0) + COALESCE(p_tokens, 0),
           web_searches = COALESCE(web_searches, 0) + COALESCE(p_web_searches, 0),
           cost_usd     = COALESCE(cost_usd, 0)     + COALESCE(p_cost, 0)
     WHERE id = p_presentation;
$$;

REVOKE ALL ON FUNCTION public.commercial_presentation_add_usage(UUID, INTEGER, INTEGER, NUMERIC) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
