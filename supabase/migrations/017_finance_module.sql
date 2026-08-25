-- ============================================================
-- 017 — Cash Box (Finance) module — foundation slice
-- ============================================================
-- Run this on an EXISTING production database created from an earlier 001.
-- Fresh databases already have everything (merged into 001_schema.sql).
-- Every statement is idempotent and SAFE TO RE-RUN.
--
-- See docs/cashbox-requirements.md for the full brief. This migration covers
-- the foundation slice built first: Epic A (access, simplified — see note
-- below), Epic B (projects & team), Epic C-01/02 (funding & running balance).
-- Receipt capture, AI extraction, the review/flag queue (Epic D/E) and the
-- formal weekly caja/audit/Excel layer (Epic F onward) land in later
-- migrations once this slice is working end-to-end.
--
-- ACCESS MODEL — deliberately simplified from the brief for this first slice.
-- The brief's Epic A asks for a full super-admin/domain-scoped-admin split
-- (editorial-admin and finance-admin mutually exclusive, a new "super admin"
-- role that provisions both). That is a breaking change to the existing
-- single admin role and is explicitly deferred ("we will the mods later").
-- For now: the existing `role = 'admin'` keeps full, unrestricted access to
-- EVERYTHING, finance included — unchanged from today. A new `finance_role`
-- column on profiles/invitations grants finance access to specific accounts,
-- exactly like every other can_access_* module flag, with two values:
--   'finance_admin' — the Finance Admin console (Epics B/C/E/H)
--   'field'         — the field app (Epics D), further scoped per-project by
--                     finance_project_members.project_role (director/sales_rep)
-- NULL means no finance access at all (today's default for every account).
-- ============================================================

-- ------------------------------------------------------------
-- 1. ACCESS: finance_role on profiles + invitations
-- ------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS finance_role TEXT
        CHECK (finance_role IN ('finance_admin', 'field'));

ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS finance_role TEXT
        CHECK (finance_role IN ('finance_admin', 'field'));

-- Re-declare handle_new_user to also copy finance_role from the invite.
-- Platform admins never get a finance_role here — they reach every finance
-- screen through role = 'admin' instead (see canAccessFinance/isFinanceAdmin
-- in src/lib/access.ts), so this column stays NULL for them by design.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_invite public.invitations%ROWTYPE;
    v_role   public.user_role;
BEGIN
    SELECT * INTO v_invite
    FROM public.invitations
    WHERE email     = NEW.email
      AND status    = 'pending'
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;

    v_role := COALESCE(v_invite.role, 'user');

    INSERT INTO public.profiles (
        id, email, full_name, role, token_limit, status,
        can_access_interview, can_access_transcriptions,
        can_access_business_cases, can_access_editorial_briefs,
        can_access_meeting_preparation, finance_role
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        v_role,
        CASE WHEN v_role = 'admin' THEN NULL
             ELSE COALESCE(v_invite.token_limit, 2000000) END,
        'active',
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_interview, TRUE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_transcriptions, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_business_cases, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_editorial_briefs, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_meeting_preparation, FALSE) END,
        CASE WHEN v_role = 'admin' THEN NULL
             ELSE v_invite.finance_role END
    );

    IF v_invite.id IS NOT NULL THEN
        UPDATE public.invitations
        SET status      = 'accepted',
            accepted_by = NEW.id,
            accepted_at = NOW()
        WHERE id = v_invite.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 2. PROJECTS (Epic B-01) — one independent balance container each
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_projects (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT        NOT NULL,
    country             TEXT        NOT NULL,
    settlement_currency TEXT        NOT NULL CHECK (settlement_currency IN ('USD', 'EUR')),
    exchange_rate       NUMERIC(12, 6) NOT NULL,
    media_publication   TEXT        NOT NULL DEFAULT '',
    status              TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_by          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS finance_projects_updated_at ON public.finance_projects;
CREATE TRIGGER finance_projects_updated_at
    BEFORE UPDATE ON public.finance_projects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 3. PROJECT MEMBERS (Epic B-02/B-03) — exactly one director, N sales reps
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_project_members (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id   UUID        NOT NULL REFERENCES public.finance_projects(id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    project_role TEXT        NOT NULL CHECK (project_role IN ('director', 'sales_rep')),
    added_by     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, user_id)
);

-- Enforces "exactly one Director per project" (brief B-02) at the database
-- level, not just in application code — a partial unique index on project_id
-- restricted to director rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_one_director_per_project
    ON public.finance_project_members(project_id) WHERE project_role = 'director';

CREATE INDEX IF NOT EXISTS idx_finance_project_members_user
    ON public.finance_project_members(user_id);

-- ------------------------------------------------------------
-- 4. FUNDING (Epic C-01) — money in, photographic evidence required
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_fundings (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id        UUID        NOT NULL REFERENCES public.finance_projects(id) ON DELETE CASCADE,
    amount            NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    date_sent         DATE        NOT NULL,
    proof_image_path  TEXT        NOT NULL,
    recorded_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_fundings_project
    ON public.finance_fundings(project_id, date_sent);

-- ------------------------------------------------------------
-- 5. EXPENSES + FLAGS (Epic D/E scaffolding — logging lands in the next
--    migration; the table exists now so the balance ledger, in-flight
--    Epic C-02, has something real to subtract).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_expenses (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID        NOT NULL REFERENCES public.finance_projects(id) ON DELETE CASCADE,
    logged_by           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    category            TEXT        NOT NULL CHECK (category IN (
                            'transport', 'accommodation', 'communications',
                            'other_services', 'printing_office', 'bank_charges'
                        )),
    concept             TEXT        NOT NULL,
    expense_date        DATE        NOT NULL,
    reference           TEXT,
    vendor               TEXT,
    local_amount         NUMERIC(12, 2) NOT NULL CHECK (local_amount > 0),
    local_currency       TEXT        NOT NULL,
    exchange_rate_used   NUMERIC(12, 6) NOT NULL,
    settlement_amount    NUMERIC(12, 2) NOT NULL CHECK (settlement_amount > 0),
    receipt_file_path    TEXT,
    status               TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    rejection_reason      TEXT,
    reviewed_by           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_expenses_project_status
    ON public.finance_expenses(project_id, status);

DROP TRIGGER IF EXISTS finance_expenses_updated_at ON public.finance_expenses;
CREATE TRIGGER finance_expenses_updated_at
    BEFORE UPDATE ON public.finance_expenses
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.finance_expense_flags (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_id  UUID        NOT NULL REFERENCES public.finance_expenses(id) ON DELETE CASCADE,
    flag_type   TEXT        NOT NULL,
    severity    TEXT        NOT NULL CHECK (severity IN ('info', 'warn', 'crit')),
    message     TEXT        NOT NULL,
    resolved    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_expense_flags_expense
    ON public.finance_expense_flags(expense_id);

-- ------------------------------------------------------------
-- 6. HELPER PREDICATES — mirrors public.user_role(); kept until after every
--    table they query already exists. Plain "sql"-language functions (unlike
--    plpgsql) are parsed against the catalog at CREATE time, not deferred to
--    first call — defining is_finance_project_member() any earlier, while
--    finance_project_members didn't exist yet, is exactly what broke this
--    migration the first time it ran.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_finance_admin()
RETURNS BOOLEAN AS $$
    SELECT public.user_role() = 'admin'
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND finance_role = 'finance_admin'
        );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_finance_project_member(p_project_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.finance_project_members
        WHERE project_id = p_project_id AND user_id = auth.uid()
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 7. STORAGE — private bucket for funding proofs + receipt images
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-receipts', 'finance-receipts', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Object paths are "<project_id>/<uuid>.<ext>". Any member of the project
-- (director, sales rep, or a finance admin) may read/write; finance admins
-- (and platform admins) may also read across every project.
DROP POLICY IF EXISTS "Project members manage finance receipts storage" ON storage.objects;
CREATE POLICY "Project members manage finance receipts storage"
    ON storage.objects FOR ALL TO authenticated
    USING (
        bucket_id = 'finance-receipts'
        AND (
            public.is_finance_admin()
            OR public.is_finance_project_member(((storage.foldername(name))[1])::uuid)
        )
    )
    WITH CHECK (
        bucket_id = 'finance-receipts'
        AND (
            public.is_finance_admin()
            OR public.is_finance_project_member(((storage.foldername(name))[1])::uuid)
        )
    );

-- ------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.finance_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_fundings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_expenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_expense_flags   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance admins manage projects" ON public.finance_projects;
CREATE POLICY "Finance admins manage projects"
    ON public.finance_projects FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read their own projects" ON public.finance_projects;
CREATE POLICY "Members read their own projects"
    ON public.finance_projects FOR SELECT
    USING (public.is_finance_project_member(id));

DROP POLICY IF EXISTS "Finance admins manage project members" ON public.finance_project_members;
CREATE POLICY "Finance admins manage project members"
    ON public.finance_project_members FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read their own project roster" ON public.finance_project_members;
CREATE POLICY "Members read their own project roster"
    ON public.finance_project_members FOR SELECT
    USING (public.is_finance_project_member(project_id));

DROP POLICY IF EXISTS "Finance admins manage fundings" ON public.finance_fundings;
CREATE POLICY "Finance admins manage fundings"
    ON public.finance_fundings FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read their own project fundings" ON public.finance_fundings;
CREATE POLICY "Members read their own project fundings"
    ON public.finance_fundings FOR SELECT
    USING (public.is_finance_project_member(project_id));

DROP POLICY IF EXISTS "Finance admins manage expenses" ON public.finance_expenses;
CREATE POLICY "Finance admins manage expenses"
    ON public.finance_expenses FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read their own project expenses" ON public.finance_expenses;
CREATE POLICY "Members read their own project expenses"
    ON public.finance_expenses FOR SELECT
    USING (public.is_finance_project_member(project_id));
DROP POLICY IF EXISTS "Members log expenses on their own projects" ON public.finance_expenses;
CREATE POLICY "Members log expenses on their own projects"
    ON public.finance_expenses FOR INSERT
    WITH CHECK (public.is_finance_project_member(project_id) AND logged_by = auth.uid());

DROP POLICY IF EXISTS "Finance admins manage expense flags" ON public.finance_expense_flags;
CREATE POLICY "Finance admins manage expense flags"
    ON public.finance_expense_flags FOR ALL USING (public.is_finance_admin());
DROP POLICY IF EXISTS "Members read flags on their own project expenses" ON public.finance_expense_flags;
CREATE POLICY "Members read flags on their own project expenses"
    ON public.finance_expense_flags FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.finance_expenses e
            WHERE e.id = expense_id AND public.is_finance_project_member(e.project_id)
        )
    );
