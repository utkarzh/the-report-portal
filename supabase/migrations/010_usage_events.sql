-- ============================================================
-- 010: USAGE EVENTS LEDGER  (+ research generation status)
-- ------------------------------------------------------------
-- Idempotent. Safe to re-run.
--
-- WHY: usage/cost used to be stamped onto the mutable research_sessions /
-- transcriptions rows. Regenerating research OVERWROTE those totals, so every
-- regeneration was lost to analytics, and transcription (refine/translate)
-- Claude spend was never in analytics at all. This introduces an append-only
-- ledger — one immutable row per Claude call — as the single source of truth
-- for analytics (satisfies US-016a: "every generation logged: ID, tokens,
-- user, workflow, errors"). The per-item rows keep their totals for the item
-- UI; analytics now reads the ledger instead.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.usage_events (
    id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Nullable + SET NULL: keep usage history when a user is deleted (grouped
    -- under "Deleted user" in analytics, same as research_sessions).
    user_id       UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
    -- 'research' | 'research_questions' | 'transcript_refine' | 'transcript_translate'
    workflow      TEXT          NOT NULL,
    -- research_sessions.id or transcriptions.id. Intentionally NO foreign key:
    -- the ledger must survive deletion of the underlying item.
    source_id     UUID,
    model         TEXT,
    tokens_input  INTEGER       NOT NULL DEFAULT 0,
    tokens_output INTEGER       NOT NULL DEFAULT 0,
    tokens_total  INTEGER       NOT NULL DEFAULT 0,
    web_searches  INTEGER       NOT NULL DEFAULT 0,
    cost_usd      NUMERIC(10, 6) NOT NULL DEFAULT 0,
    -- 'success' | 'error'
    status        TEXT          NOT NULL DEFAULT 'success',
    error         TEXT,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON public.usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_id    ON public.usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_workflow   ON public.usage_events(workflow);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- Admins read the ledger; inserts come from the service role (bypasses RLS).
DROP POLICY IF EXISTS "Admins can read usage events" ON public.usage_events;
CREATE POLICY "Admins can read usage events"
    ON public.usage_events FOR SELECT USING (public.user_role() = 'admin');

-- ------------------------------------------------------------
-- Research generation status (Phase C): lets a user who returns mid-run see
-- "Generating…" and reconnect, instead of the state living only client-side.
-- 'pending' (created, not generated) | 'generating' | 'complete' | 'failed'.
-- Existing rows default to 'complete' — they were all created by the old flow
-- that always produced output.
-- ------------------------------------------------------------
ALTER TABLE public.research_sessions
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'complete';

-- ------------------------------------------------------------
-- Best-effort backfill so analytics isn't empty for past months.
-- Guarded by NOT EXISTS so re-running the migration never double-inserts.
--
-- Limitations (accepted as best-effort):
--   • research: regenerations were already collapsed onto one row, so each
--     session becomes ONE 'research' event carrying its current stored totals
--     (which already include any accumulated question spend).
--   • transcript: refine and translate spend were summed on one row, so each
--     transcription becomes ONE 'transcript_refine' event.
-- Going forward every call logs its own precise event.
-- ------------------------------------------------------------
INSERT INTO public.usage_events
    (user_id, workflow, source_id, tokens_input, tokens_output, tokens_total, web_searches, cost_usd, status, created_at)
SELECT
    rs.user_id, 'research', rs.id,
    COALESCE(rs.tokens_input, 0), COALESCE(rs.tokens_output, 0), COALESCE(rs.tokens_total, 0),
    COALESCE(rs.web_searches, 0), COALESCE(rs.cost_usd, 0), 'success', rs.created_at
FROM public.research_sessions rs
WHERE (COALESCE(rs.tokens_total, 0) > 0 OR COALESCE(rs.cost_usd, 0) > 0)
  AND NOT EXISTS (
      SELECT 1 FROM public.usage_events ue
      WHERE ue.source_id = rs.id AND ue.workflow = 'research'
  );

INSERT INTO public.usage_events
    (user_id, workflow, source_id, tokens_input, tokens_output, tokens_total, web_searches, cost_usd, status, created_at)
SELECT
    t.user_id, 'transcript_refine', t.id,
    COALESCE(t.tokens_input, 0), COALESCE(t.tokens_output, 0), COALESCE(t.tokens_total, 0),
    0, COALESCE(t.cost_usd, 0), 'success', t.created_at
FROM public.transcriptions t
WHERE (COALESCE(t.tokens_total, 0) > 0 OR COALESCE(t.cost_usd, 0) > 0)
  AND NOT EXISTS (
      SELECT 1 FROM public.usage_events ue
      WHERE ue.source_id = t.id AND ue.workflow LIKE 'transcript_%'
  );
