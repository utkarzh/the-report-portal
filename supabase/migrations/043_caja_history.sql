-- ============================================================
-- 043 — Cash Box: append-only history of every money change
-- ============================================================
-- Run this on a database that already ran 017-042. Idempotent and safe to
-- re-run. The app keeps working before it runs (writes to the history are
-- best-effort and the History panels just show nothing), but nothing is
-- recorded until it does.
--
-- Client review, 26 Oct 2026: 9 of 75 verified tickets had been changed
-- after verification with no record of what changed or who changed it, and
-- funding edits left no trace at all — against the brief's rule #8 ("the
-- platform is the full audit trail"). From now on every action that touches
-- money or status writes one row here: who, when, what, and each field's
-- old → new value.
--
-- Deliberately:
--   * no foreign keys — the history must outlive the ticket, funding or
--     account it describes (a removed ticket's history stays readable);
--     actor_name is snapshotted for the same reason, like logged_by_name;
--   * append-only even for the service role: a trigger rejects UPDATE,
--     DELETE and TRUNCATE, so no API bug or script can rewrite the past.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.finance_audit_log (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id  UUID        NOT NULL,
    entity_type TEXT        NOT NULL CHECK (entity_type IN ('expense', 'funding', 'project', 'transfer')),
    entity_id   UUID        NOT NULL,
    action      TEXT        NOT NULL,
    actor_id    UUID,
    actor_name  TEXT        NOT NULL DEFAULT '',
    -- { "<field>": { "from": …, "to": … } }
    changes     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_audit_log_entity
    ON public.finance_audit_log(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_finance_audit_log_project
    ON public.finance_audit_log(project_id, created_at);

CREATE OR REPLACE FUNCTION public.finance_audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'finance_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_audit_log_no_update ON public.finance_audit_log;
CREATE TRIGGER finance_audit_log_no_update
    BEFORE UPDATE OR DELETE ON public.finance_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.finance_audit_log_append_only();

DROP TRIGGER IF EXISTS finance_audit_log_no_truncate ON public.finance_audit_log;
CREATE TRIGGER finance_audit_log_no_truncate
    BEFORE TRUNCATE ON public.finance_audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.finance_audit_log_append_only();

ALTER TABLE public.finance_audit_log ENABLE ROW LEVEL SECURITY;

-- Reads only: rows are written by the API with the service role.
DROP POLICY IF EXISTS "Finance admins read history" ON public.finance_audit_log;
CREATE POLICY "Finance admins read history"
    ON public.finance_audit_log FOR SELECT USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read their own project history" ON public.finance_audit_log;
CREATE POLICY "Members read their own project history"
    ON public.finance_audit_log FOR SELECT
    USING (public.is_finance_project_member(project_id));
