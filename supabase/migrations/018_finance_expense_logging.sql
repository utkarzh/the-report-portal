-- ============================================================
-- 018 — Cash Box: receipts/expense logging, weekly caja, incidents,
--        inter-project transfers, notifications
-- ============================================================
-- Run this on an EXISTING database that already ran 017_finance_module.sql.
-- Idempotent and safe to re-run. See docs/cashbox-requirements.md.
--
-- Adds:
--   1. finance_receipts            — one row per uploaded image/PDF, holds
--                                     the raw AI extraction (Epic D-03/D-05)
--   2. finance_expenses additions  — receipt_id, nights, prior_approval_granted,
--                                     caja_id (Epic D/E, F-01)
--   3. finance_cajas + events      — weekly state machine (Epic F-01/F-02/F-03)
--   4. finance_incidents + messages — threaded corrections (Epic G-01)
--   5. finance_transfers           — inter-project fund moves (Epic J-01)
--   6. finance_notifications       — in-app "what needs my attention" (Epic G-02)
--
-- NOTE on Epic F-04 (official Excel export): deliberately NOT built here.
-- The brief requires the export to reuse TRC's actual Excel template with its
-- existing SUM/currency formulas UNTOUCHED (non-negotiable rule #3) — we do
-- not have that template file. Building a guessed Excel structure now would
-- risk violating that rule when the real file arrives, so the audit report
-- (F-03) is generated and stored as structured text/verdict here, exportable
-- as a .docx via the existing template renderer, with real Excel generation
-- wired in once TRC supplies the template.
-- ============================================================

-- ------------------------------------------------------------
-- 1. RECEIPTS (raw upload + AI extraction, one row per image/PDF)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_receipts (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id    UUID        NOT NULL REFERENCES public.finance_projects(id) ON DELETE CASCADE,
    uploaded_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    file_path     TEXT        NOT NULL,
    file_type     TEXT        NOT NULL,
    ai_extraction JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_receipts_project ON public.finance_receipts(project_id);

ALTER TABLE public.finance_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance admins manage receipts" ON public.finance_receipts;
CREATE POLICY "Finance admins manage receipts"
    ON public.finance_receipts FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read their own project receipts" ON public.finance_receipts;
CREATE POLICY "Members read their own project receipts"
    ON public.finance_receipts FOR SELECT
    USING (public.is_finance_project_member(project_id));
DROP POLICY IF EXISTS "Members upload receipts on their own projects" ON public.finance_receipts;
CREATE POLICY "Members upload receipts on their own projects"
    ON public.finance_receipts FOR INSERT
    WITH CHECK (public.is_finance_project_member(project_id) AND uploaded_by = auth.uid());

-- ------------------------------------------------------------
-- 2. EXPENSES — link to receipt + caja, accommodation nights, PR approval
-- ------------------------------------------------------------
ALTER TABLE public.finance_expenses
    ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES public.finance_receipts(id) ON DELETE SET NULL;
ALTER TABLE public.finance_expenses
    ADD COLUMN IF NOT EXISTS nights INTEGER;
ALTER TABLE public.finance_expenses
    ADD COLUMN IF NOT EXISTS prior_approval_granted BOOLEAN NOT NULL DEFAULT FALSE;
-- caja_id is nullable and only set once a weekly caja exists for that period —
-- an expense can be logged and reviewed independently of the formal caja
-- (Epic D/E don't require F to exist), matching the brief's MVP/Phase-2 split.
ALTER TABLE public.finance_expenses
    ADD COLUMN IF NOT EXISTS caja_id UUID;

-- ------------------------------------------------------------
-- 3. WEEKLY CAJA — state machine (Epic F-01/F-02/F-03)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_cajas (
    id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id             UUID        NOT NULL REFERENCES public.finance_projects(id) ON DELETE CASCADE,
    week_number            INTEGER     NOT NULL,
    week_start             DATE        NOT NULL,
    week_end               DATE        NOT NULL,
    stage                  TEXT        NOT NULL DEFAULT 'draft'
        CHECK (stage IN ('draft', 'ready', 'submitted', 'under_review', 'incidents', 'resubmitted', 'approved', 'closed')),
    cash_confirmed_amount  NUMERIC(12, 2),
    cash_confirmed_at      TIMESTAMPTZ,
    cash_confirmed_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    submitted_at           TIMESTAMPTZ,
    submitted_by           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_at            TIMESTAMPTZ,
    approved_by            UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    audit_verdict          TEXT        CHECK (audit_verdict IN ('pass', 'pass_with_observations', 'review_required', 'high_risk')),
    audit_report           TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, week_number)
);

-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so guard it explicitly to
-- keep this migration safe to re-run.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'finance_expenses_caja_id_fkey'
    ) THEN
        ALTER TABLE public.finance_expenses
            ADD CONSTRAINT finance_expenses_caja_id_fkey
            FOREIGN KEY (caja_id) REFERENCES public.finance_cajas(id) ON DELETE SET NULL;
    END IF;
END $$;

DROP TRIGGER IF EXISTS finance_cajas_updated_at ON public.finance_cajas;
CREATE TRIGGER finance_cajas_updated_at
    BEFORE UPDATE ON public.finance_cajas
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.finance_caja_events (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    caja_id    UUID        NOT NULL REFERENCES public.finance_cajas(id) ON DELETE CASCADE,
    from_stage TEXT,
    to_stage   TEXT        NOT NULL,
    comment    TEXT,
    actor_id   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_caja_events_caja ON public.finance_caja_events(caja_id, created_at);

ALTER TABLE public.finance_cajas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_caja_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance admins manage cajas" ON public.finance_cajas;
CREATE POLICY "Finance admins manage cajas"
    ON public.finance_cajas FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read own project cajas" ON public.finance_cajas;
CREATE POLICY "Members read own project cajas"
    ON public.finance_cajas FOR SELECT USING (public.is_finance_project_member(project_id));
DROP POLICY IF EXISTS "Members manage draft cajas on own projects" ON public.finance_cajas;
CREATE POLICY "Members manage draft cajas on own projects"
    ON public.finance_cajas FOR INSERT
    WITH CHECK (public.is_finance_project_member(project_id));
DROP POLICY IF EXISTS "Members update own project cajas" ON public.finance_cajas;
CREATE POLICY "Members update own project cajas"
    ON public.finance_cajas FOR UPDATE USING (public.is_finance_project_member(project_id));

DROP POLICY IF EXISTS "Finance admins manage caja events" ON public.finance_caja_events;
CREATE POLICY "Finance admins manage caja events"
    ON public.finance_caja_events FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read own project caja events" ON public.finance_caja_events;
CREATE POLICY "Members read own project caja events"
    ON public.finance_caja_events FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.finance_cajas c WHERE c.id = caja_id AND public.is_finance_project_member(c.project_id)));
DROP POLICY IF EXISTS "Members log own project caja events" ON public.finance_caja_events;
CREATE POLICY "Members log own project caja events"
    ON public.finance_caja_events FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM public.finance_cajas c WHERE c.id = caja_id AND public.is_finance_project_member(c.project_id)));

-- ------------------------------------------------------------
-- 4. INCIDENTS — threaded corrections (Epic G-01)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_incidents (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    caja_id         UUID        NOT NULL REFERENCES public.finance_cajas(id) ON DELETE CASCADE,
    expense_id      UUID        REFERENCES public.finance_expenses(id) ON DELETE SET NULL,
    description     TEXT        NOT NULL,
    required_action TEXT        NOT NULL,
    due_date        DATE,
    status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.finance_incident_messages (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id UUID        NOT NULL REFERENCES public.finance_incidents(id) ON DELETE CASCADE,
    author_id   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    message     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_incidents_caja ON public.finance_incidents(caja_id);
CREATE INDEX IF NOT EXISTS idx_finance_incident_messages_incident ON public.finance_incident_messages(incident_id, created_at);

ALTER TABLE public.finance_incidents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_incident_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance admins manage incidents" ON public.finance_incidents;
CREATE POLICY "Finance admins manage incidents"
    ON public.finance_incidents FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read own project incidents" ON public.finance_incidents;
CREATE POLICY "Members read own project incidents"
    ON public.finance_incidents FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.finance_cajas c WHERE c.id = caja_id AND public.is_finance_project_member(c.project_id)));

DROP POLICY IF EXISTS "Finance admins manage incident messages" ON public.finance_incident_messages;
CREATE POLICY "Finance admins manage incident messages"
    ON public.finance_incident_messages FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read+post own project incident messages" ON public.finance_incident_messages;
CREATE POLICY "Members read+post own project incident messages"
    ON public.finance_incident_messages FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.finance_incidents i JOIN public.finance_cajas c ON c.id = i.caja_id
        WHERE i.id = incident_id AND public.is_finance_project_member(c.project_id)
    ));
DROP POLICY IF EXISTS "Members post own project incident messages" ON public.finance_incident_messages;
CREATE POLICY "Members post own project incident messages"
    ON public.finance_incident_messages FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.finance_incidents i JOIN public.finance_cajas c ON c.id = i.caja_id
        WHERE i.id = incident_id AND public.is_finance_project_member(c.project_id)
    ) AND author_id = auth.uid());

-- ------------------------------------------------------------
-- 5. INTER-PROJECT TRANSFERS (Epic J-01)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_transfers (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_project_id UUID        NOT NULL REFERENCES public.finance_projects(id) ON DELETE CASCADE,
    to_project_id   UUID        NOT NULL REFERENCES public.finance_projects(id) ON DELETE CASCADE,
    amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    reason          TEXT        NOT NULL DEFAULT '',
    created_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_project_id <> to_project_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_transfers_from ON public.finance_transfers(from_project_id);
CREATE INDEX IF NOT EXISTS idx_finance_transfers_to ON public.finance_transfers(to_project_id);

ALTER TABLE public.finance_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance admins manage transfers" ON public.finance_transfers;
CREATE POLICY "Finance admins manage transfers"
    ON public.finance_transfers FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read transfers touching their projects" ON public.finance_transfers;
CREATE POLICY "Members read transfers touching their projects"
    ON public.finance_transfers FOR SELECT
    USING (public.is_finance_project_member(from_project_id) OR public.is_finance_project_member(to_project_id));

-- ------------------------------------------------------------
-- 6. NOTIFICATIONS — in-app only for this build (Epic G-02). Brief says
--    "notified"; it doesn't mandate email, and this app already has an SMTP
--    integration reserved for auth codes — reusing it for finance alerts is
--    a deliberate follow-up, not built here, so a real inbox exists on day one.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_notifications (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type       TEXT        NOT NULL,
    message    TEXT        NOT NULL,
    link       TEXT,
    read       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_notifications_user ON public.finance_notifications(user_id, read, created_at DESC);

ALTER TABLE public.finance_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own notifications" ON public.finance_notifications;
CREATE POLICY "Users manage their own notifications"
    ON public.finance_notifications FOR ALL USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Finance admins insert notifications" ON public.finance_notifications;
CREATE POLICY "Finance admins insert notifications"
    ON public.finance_notifications FOR INSERT WITH CHECK (public.is_finance_admin());
