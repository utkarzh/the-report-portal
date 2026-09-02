-- ============================================================
-- 021 — Interview Request Letter & Email Generator (Module 5, US-049–061)
-- ============================================================
-- Run this on an EXISTING production database created from an earlier 001.
-- Fresh databases already have everything (merged into 001_schema.sql).
-- Every statement is idempotent and SAFE TO RE-RUN — it uses
-- IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP POLICY IF EXISTS /
-- CREATE OR REPLACE throughout and never drops or alters existing data.
--
-- Turns a small set of project inputs into an approved one-page Interview
-- Request Letter (built paragraph-by-paragraph against an admin-managed
-- universal TRC/GFDI template), then a reusable general email, with optional
-- per-recipient personalization once both are approved. Modeled directly on
-- the Commercial Meeting Preparation module (014) — the spec names it as the
-- closest precedent: multi-stage stateful workflow, marker-delimited AI
-- output, per-piece regeneration against "do not contradict" context,
-- versioned singleton templates via the shared PromptVersionHistory component.
--
-- What it adds:
--   1. Per-user access flag (profiles + invitations) + handle_new_user copy
--   2. interview_letter_templates (+ versions) — 2 fixed variants (TRC / GFDI)
--   3. interview_letter_projects   — one row per letter/email project (the
--      workflow's state machine)
--   4. interview_letter_personalizations — one row per personalized recipient
--
-- Depends on objects already created by 001: public.update_updated_at(),
-- public.user_role(), public.profiles, and the uuid_generate_v4() extension.
-- Note: usage_events.workflow is a plain TEXT column with no CHECK constraint,
-- so the new workflow values ('interview_letter_research' etc.) need no DDL.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PER-USER MODULE ACCESS
-- ------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_access_interview_letter_generator BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS can_access_interview_letter_generator BOOLEAN NOT NULL DEFAULT FALSE;

-- Re-declare handle_new_user to also copy the new invite flag onto the new
-- profile. Admins always get full access. Preserves every column set by the
-- most recent prior declaration (017_finance_module.sql), including finance_role.
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
        can_access_meeting_preparation, finance_role,
        can_access_interview_letter_generator
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
             ELSE v_invite.finance_role END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_interview_letter_generator, FALSE) END
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
-- 2. LETTER TEMPLATES (exactly 2 fixed variants) + version history
-- ------------------------------------------------------------
-- `structure` is an ordered JSON array of paragraph slots:
--   { key, type: 'fixed'|'variable', label, content?, instructions?, wordBudget? }
-- 'fixed' slots carry immutable `content` (never sent through generation).
-- 'variable' slots carry `instructions` + `wordBudget` and are what the
-- letter-generation call fills in. Seeded with placeholder wording now per
-- the spec ("templates can be built and tested with placeholder wording
-- now; real TRC/GFDI copy can be dropped in later without a schema change")
-- so the module is testable end-to-end immediately.
CREATE TABLE IF NOT EXISTS public.interview_letter_templates (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    company     TEXT        NOT NULL UNIQUE
        CHECK (company IN ('TRC', 'GFDI')),
    structure   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.interview_letter_templates (company, structure)
SELECT 'TRC', $seed$[
  {"key": "salutation", "type": "fixed", "label": "Salutation", "content": "Dear [Recipient],"},
  {"key": "opening", "type": "variable", "label": "Opening / Why-Now Hook", "instructions": "Open by introducing The Report Company and state the why-now hook — the specific reason this interview request is timely for this recipient right now.", "wordBudget": 60},
  {"key": "publication_context", "type": "variable", "label": "Publication & Media Partner Context", "instructions": "Introduce the media partner publication, its standing, and why this publication is the right platform for the recipient's story.", "wordBudget": 70},
  {"key": "value_proposition", "type": "variable", "label": "Value to the Recipient", "instructions": "Explain what the recipient and their organisation gain from participating — visibility, positioning, audience reached.", "wordBudget": 70},
  {"key": "ask", "type": "variable", "label": "The Ask", "instructions": "Make the specific interview request: format, approximate time commitment, and next step.", "wordBudget": 50},
  {"key": "closing", "type": "fixed", "label": "Closing", "content": "We would be delighted to schedule this at your earliest convenience. Thank you for your consideration.\n\nWarm regards,\nThe Report Company"}
]$seed$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.interview_letter_templates WHERE company = 'TRC');

INSERT INTO public.interview_letter_templates (company, structure)
SELECT 'GFDI', $seed$[
  {"key": "salutation", "type": "fixed", "label": "Salutation", "content": "Dear [Recipient],"},
  {"key": "opening", "type": "variable", "label": "Opening / Why-Now Hook", "instructions": "Open by introducing the Global Foreign Direct Investment (GFDI) platform and state the why-now hook — the specific reason this interview request is timely for this recipient right now.", "wordBudget": 60},
  {"key": "publication_context", "type": "variable", "label": "Publication & Media Partner Context", "instructions": "Introduce the media partner publication, its standing, and why this publication is the right platform for the recipient's story.", "wordBudget": 70},
  {"key": "value_proposition", "type": "variable", "label": "Value to the Recipient", "instructions": "Explain what the recipient and their organisation gain from participating — visibility, positioning, audience reached, investment narrative.", "wordBudget": 70},
  {"key": "ask", "type": "variable", "label": "The Ask", "instructions": "Make the specific interview request: format, approximate time commitment, and next step.", "wordBudget": 50},
  {"key": "closing", "type": "fixed", "label": "Closing", "content": "We would be delighted to schedule this at your earliest convenience. Thank you for your consideration.\n\nWarm regards,\nGFDI"}
]$seed$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.interview_letter_templates WHERE company = 'GFDI');

DROP TRIGGER IF EXISTS interview_letter_templates_updated_at ON public.interview_letter_templates;
CREATE TRIGGER interview_letter_templates_updated_at
    BEFORE UPDATE ON public.interview_letter_templates
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.interview_letter_templates_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    company     TEXT        NOT NULL
        CHECK (company IN ('TRC', 'GFDI')),
    structure   JSONB       NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_letter_templates_versions_company_created
    ON public.interview_letter_templates_versions(company, created_at DESC);

-- ------------------------------------------------------------
-- 3. PROJECTS (one row per run; the workflow state machine)
-- ------------------------------------------------------------
-- user_id is nullable and SET NULL on profile delete so history survives when
-- an author is permanently deleted (US-011 pattern, mirrors research_sessions).
CREATE TABLE IF NOT EXISTS public.interview_letter_projects (
    id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,

    -- Screen 1 — user input (US-050)
    company                     TEXT        NOT NULL
        CHECK (company IN ('TRC', 'GFDI')),
    project_country             TEXT        NOT NULL,
    media_partner               TEXT        NOT NULL,
    media_partner_country       TEXT        NOT NULL DEFAULT '',
    hook_input                  TEXT        NOT NULL DEFAULT '',

    -- Screen 2 — research + hook (US-051/052). `research` is a JSON array of
    -- bullet strings, each carrying its own inline "[Source, date](url)"
    -- citation — same inline-citation convention as meeting-prep/documents,
    -- not a separate structured sources column.
    research                    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    hook_ai_suggestion          TEXT,
    confirmed_hook               TEXT,
    hook_source                 TEXT
        CHECK (hook_source IN ('user', 'ai')),

    -- Template structure snapshot used for this project's letter (US-061) —
    -- the full source of truth for "what template produced this letter",
    -- same snapshot-inline pattern as meeting_prep_sessions' prompt snapshots
    -- rather than a FK to a versions-table row (the live template isn't
    -- necessarily present there until it's next edited).
    template_structure_snapshot JSONB,

    -- Paragraph-level state (US-053/054) — array shadowing the template
    -- structure: [{key, type, label, content, status:'pending'|'locked', lastFeedback}]
    paragraphs                  JSONB       NOT NULL DEFAULT '[]'::jsonb,

    -- Master outputs (US-055/056/057)
    master_letter                TEXT,
    master_email                 TEXT,

    -- Prompt snapshots (what was actually used for this run).
    research_prompt_snapshot    TEXT,
    letter_prompt_snapshot      TEXT,
    email_prompt_snapshot       TEXT,

    stage                       TEXT        NOT NULL DEFAULT 'input'
        CHECK (stage IN (
            'input', 'researching', 'hook_review',
            'letter_generating', 'letter_review', 'letter_approved',
            'email_generating', 'email_review', 'complete', 'failed'
        )),
    error                       TEXT,

    -- Usage accumulates across every AI call for this project.
    tokens_input                INTEGER     DEFAULT 0,
    tokens_output                INTEGER     DEFAULT 0,
    tokens_total                 INTEGER     DEFAULT 0,
    web_searches                 INTEGER     DEFAULT 0,
    cost_usd                     NUMERIC(10, 6) DEFAULT 0,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_letter_projects_user_id
    ON public.interview_letter_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_interview_letter_projects_created
    ON public.interview_letter_projects(created_at DESC);

DROP TRIGGER IF EXISTS interview_letter_projects_updated_at ON public.interview_letter_projects;
CREATE TRIGGER interview_letter_projects_updated_at
    BEFORE UPDATE ON public.interview_letter_projects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 4. PERSONALIZED OUTPUTS (US-058) — one row per recipient, unlimited per project
-- ------------------------------------------------------------
-- CASCADE on project delete: unlike user_id (SET NULL, preserves standalone
-- history), a personalization has no meaning detached from its project.
CREATE TABLE IF NOT EXISTS public.interview_letter_personalizations (
    id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id            UUID        NOT NULL REFERENCES public.interview_letter_projects(id) ON DELETE CASCADE,
    recipient_name        TEXT,
    recipient_title       TEXT,
    recipient_organisation TEXT,
    recipient_sector      TEXT,
    recipient_context     TEXT,
    letter_text           TEXT        NOT NULL DEFAULT '',
    email_text            TEXT        NOT NULL DEFAULT '',
    tokens_total          INTEGER     DEFAULT 0,
    cost_usd              NUMERIC(10, 6) DEFAULT 0,
    created_by            UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_letter_personalizations_project
    ON public.interview_letter_personalizations(project_id, created_at DESC);

-- ------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.interview_letter_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_templates_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_personalizations     ENABLE ROW LEVEL SECURITY;

-- Templates: any authenticated user may read (needed at generation time);
-- only admins write. Writes from API routes go through the service role.
DROP POLICY IF EXISTS "Authenticated users can read letter templates" ON public.interview_letter_templates;
CREATE POLICY "Authenticated users can read letter templates"
    ON public.interview_letter_templates FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update letter templates" ON public.interview_letter_templates;
CREATE POLICY "Admins can update letter templates"
    ON public.interview_letter_templates FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage letter template versions" ON public.interview_letter_templates_versions;
CREATE POLICY "Admins can manage letter template versions"
    ON public.interview_letter_templates_versions FOR ALL USING (public.user_role() = 'admin');

-- Projects: users see/manage their own, admins see all (mirrors meeting_prep_sessions).
DROP POLICY IF EXISTS "Users can read own letter projects" ON public.interview_letter_projects;
CREATE POLICY "Users can read own letter projects"
    ON public.interview_letter_projects FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins can read all letter projects" ON public.interview_letter_projects;
CREATE POLICY "Admins can read all letter projects"
    ON public.interview_letter_projects FOR SELECT USING (public.user_role() = 'admin');
DROP POLICY IF EXISTS "Users can insert own letter projects" ON public.interview_letter_projects;
CREATE POLICY "Users can insert own letter projects"
    ON public.interview_letter_projects FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can update own letter projects" ON public.interview_letter_projects;
CREATE POLICY "Users can update own letter projects"
    ON public.interview_letter_projects FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins can delete letter projects" ON public.interview_letter_projects;
CREATE POLICY "Admins can delete letter projects"
    ON public.interview_letter_projects FOR DELETE USING (public.user_role() = 'admin');

-- Personalizations: same owner-or-admin rule, checked via the parent project.
DROP POLICY IF EXISTS "Users can read own project personalizations" ON public.interview_letter_personalizations;
CREATE POLICY "Users can read own project personalizations"
    ON public.interview_letter_personalizations FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.interview_letter_projects p
            WHERE p.id = project_id AND (p.user_id = auth.uid() OR public.user_role() = 'admin')
        )
    );
DROP POLICY IF EXISTS "Users can insert own project personalizations" ON public.interview_letter_personalizations;
CREATE POLICY "Users can insert own project personalizations"
    ON public.interview_letter_personalizations FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.interview_letter_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
