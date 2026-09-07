-- ============================================================
-- 025 — Sales Negotiation Coach module
-- ============================================================
-- Run this on an EXISTING database created from an earlier 001. Idempotent /
-- safe to re-run (IF NOT EXISTS / WHERE NOT EXISTS / DROP POLICY IF EXISTS /
-- CREATE OR REPLACE throughout; never drops or alters existing data). Merged
-- into 001_schema.sql for fresh installs.
--
-- New module (see docs — TRC Sales Negotiation Coach user stories US-033→048):
-- a Sales Executive submits a negotiation (context + audio/transcript + declared
-- outcome); the system transcribes (reusing the AssemblyAI pipeline), assembles
-- the four admin-managed TRC knowledge documents in a fixed authority order, and
-- generates a structured Report Card + an interactive coaching conversation.
--
-- Mirrors the meeting-prep module's shape (014): a per-user access flag, four
-- versioned knowledge singletons (like meeting_prep_prompt), one row per
-- negotiation carrying the whole workflow state + structured analysis, and a
-- dedicated coaching-message table (the app's old generic refinement-chat table
-- was removed, so this module gets its own — US-043).
--
-- Depends on 001: update_updated_at(), user_role(), profiles, uuid_generate_v4().
-- ============================================================

-- ------------------------------------------------------------
-- 1. PER-USER MODULE ACCESS (US-033) — same pattern as every other module
-- ------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_access_sales_negotiation_coach BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS can_access_sales_negotiation_coach BOOLEAN NOT NULL DEFAULT FALSE;

-- Shown once, the first time the user opens the module (US-047). NULL = not yet
-- acknowledged. Stored server-side so it's consistent across the user's devices.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS sales_coach_privacy_ack_at TIMESTAMPTZ;

-- Re-declare handle_new_user to also copy the new invite flag. Preserves every
-- column it already sets — CREATE OR REPLACE, safe to re-run.
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
        can_access_interview_letter_generator,
        can_access_sales_negotiation_coach
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
             ELSE COALESCE(v_invite.can_access_interview_letter_generator, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_sales_negotiation_coach, FALSE) END
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
-- 2. KNOWLEDGE DOCUMENTS (US-046) — 4 admin-managed singletons + versions
-- ------------------------------------------------------------
-- Authority order is enforced in code (US-038), not here. Seeded with
-- placeholder content so the mechanism works before TRC delivers the real docs.
CREATE TABLE IF NOT EXISTS public.sales_coach_knowledge (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_key     TEXT        NOT NULL UNIQUE
        CHECK (doc_key IN ('project_prompt', 'manual', 'method', 'examples')),
    content     TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.sales_coach_knowledge (doc_key, content)
SELECT k.doc_key, k.content FROM (VALUES
    ('project_prompt', 'PLACEHOLDER — Sales Coach Project Prompt. This is the main system instruction and the highest authority document. Replace with the TRC-delivered content. It should instruct the coach to use submission context to identify participants and interpret the recording, treat physical/off-audio events (including a signed agreement) as factual metadata unless a material inconsistency requires clarification, and preserve the declared-outcome-vs-AI-assessed-position distinction rather than treating the declared outcome as conclusive.'),
    ('manual', 'PLACEHOLDER — Manual: TRC Overcoming Objections. Replace with the TRC-delivered content (includes the suggested planteo build-up formula referenced when Sales Offer Build-up / Offer Articulation score weak).'),
    ('method', 'PLACEHOLDER — TRC Sales Coaching Method. Replace with the TRC-delivered content.'),
    ('examples', 'PLACEHOLDER — TRC Successful Negotiation Examples. Used ONLY for pattern recognition; its specific facts, dialogue or outcomes are never imported into the analysis of a different negotiation. Replace with the TRC-delivered content.')
) AS k(doc_key, content)
WHERE NOT EXISTS (SELECT 1 FROM public.sales_coach_knowledge s WHERE s.doc_key = k.doc_key);

DROP TRIGGER IF EXISTS sales_coach_knowledge_updated_at ON public.sales_coach_knowledge;
CREATE TRIGGER sales_coach_knowledge_updated_at
    BEFORE UPDATE ON public.sales_coach_knowledge
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.sales_coach_knowledge_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_key     TEXT        NOT NULL
        CHECK (doc_key IN ('project_prompt', 'manual', 'method', 'examples')),
    content     TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_coach_knowledge_versions_key_created
    ON public.sales_coach_knowledge_versions(doc_key, created_at DESC);

-- ------------------------------------------------------------
-- 3. NEGOTIATIONS (US-034→045) — one row per negotiation; the workflow record
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_coach_negotiations (
    id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Every submission is bound to the logged-in user (US-033). Nullable +
    -- SET NULL so history survives account deletion (US-011 pattern).
    user_id                UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    submitted_by_name      TEXT        NOT NULL DEFAULT '',

    -- Step 1: contextual form (US-034)
    country                TEXT,
    media_publication      TEXT,
    company                TEXT,
    interviewee_name       TEXT,
    interviewee_position   TEXT,
    company_reps           JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{name, position}]
    trc_members            JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{name, role}]
    other_comments         TEXT,
    original_filename      TEXT,

    -- Step 2: upload (US-035). Original audio is retained; the uploaded
    -- transcript is kept DISTINCT from the system-generated one (US-045).
    audio_path             TEXT,
    audio_mime             TEXT,
    transcribe_job_id      TEXT,
    uploaded_transcript    TEXT,
    system_transcript      TEXT,

    -- Step 3: declared outcome (US-036) — stored separately from the AI's
    -- assessed position (US-040), never collapsed into one column.
    declared_outcome       TEXT
        CHECK (declared_outcome IN ('signed', 'retorno', 'lost', 'uncertain')),
    outcome_details        JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- Analysis (US-039/040/041): the structured Report Card + its rendered
    -- markdown, the AI-assessed position, execution score, UV criteria, and the
    -- declared-vs-assessed discrepancy + management-review flag.
    report_card            JSONB,
    report_card_markdown   TEXT,
    ai_assessed_position   TEXT,
    execution_score        INTEGER,
    execution_denominator  INTEGER,
    uv_criteria            JSONB       NOT NULL DEFAULT '[]'::jsonb,
    discrepancy            TEXT,
    management_review      BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Version snapshots (US-048): what produced THIS Report Card. Editing a
    -- knowledge doc or changing model never rewrites a past card.
    project_prompt_snapshot TEXT,
    knowledge_versions      JSONB,     -- {project_prompt, manual, method, examples} version ids/timestamps
    model_used              TEXT,

    -- Later-outcome integration hook (client note): a future Basecamp/HubSpot
    -- sync can populate these without the Sales Executive reopening anything.
    actual_outcome         TEXT,
    actual_outcome_source  TEXT,
    actual_outcome_at      TIMESTAMPTZ,

    stage                  TEXT        NOT NULL DEFAULT 'draft'
        CHECK (stage IN ('draft', 'transcribing', 'transcribed', 'analyzing', 'complete', 'failed')),
    error                  TEXT,

    tokens_input           INTEGER     DEFAULT 0,
    tokens_output          INTEGER     DEFAULT 0,
    tokens_total           INTEGER     DEFAULT 0,
    cost_usd               NUMERIC(10, 6) DEFAULT 0,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_coach_negotiations_user   ON public.sales_coach_negotiations(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_coach_negotiations_created ON public.sales_coach_negotiations(created_at DESC);

DROP TRIGGER IF EXISTS sales_coach_negotiations_updated_at ON public.sales_coach_negotiations;
CREATE TRIGGER sales_coach_negotiations_updated_at
    BEFORE UPDATE ON public.sales_coach_negotiations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 4. COACHING MESSAGES (US-043) — dedicated per-negotiation conversation
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_coach_messages (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    negotiation_id UUID        NOT NULL REFERENCES public.sales_coach_negotiations(id) ON DELETE CASCADE,
    role           TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content        TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_coach_messages_negotiation
    ON public.sales_coach_messages(negotiation_id, created_at);

-- ------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.sales_coach_knowledge          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_coach_knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_coach_negotiations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_coach_messages           ENABLE ROW LEVEL SECURITY;

-- Knowledge: any authenticated user may read (needed at analysis time); only
-- admins write. API-route writes go through the service role.
DROP POLICY IF EXISTS "Authenticated users can read sales coach knowledge" ON public.sales_coach_knowledge;
CREATE POLICY "Authenticated users can read sales coach knowledge"
    ON public.sales_coach_knowledge FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update sales coach knowledge" ON public.sales_coach_knowledge;
CREATE POLICY "Admins can update sales coach knowledge"
    ON public.sales_coach_knowledge FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage sales coach knowledge versions" ON public.sales_coach_knowledge_versions;
CREATE POLICY "Admins can manage sales coach knowledge versions"
    ON public.sales_coach_knowledge_versions FOR ALL USING (public.user_role() = 'admin');

-- Negotiations: a Sales Executive sees only their own; admins see all (US-044/045).
DROP POLICY IF EXISTS "Users read own negotiations" ON public.sales_coach_negotiations;
CREATE POLICY "Users read own negotiations"
    ON public.sales_coach_negotiations FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all negotiations" ON public.sales_coach_negotiations;
CREATE POLICY "Admins read all negotiations"
    ON public.sales_coach_negotiations FOR SELECT USING (public.user_role() = 'admin');
DROP POLICY IF EXISTS "Users insert own negotiations" ON public.sales_coach_negotiations;
CREATE POLICY "Users insert own negotiations"
    ON public.sales_coach_negotiations FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users update own negotiations" ON public.sales_coach_negotiations;
CREATE POLICY "Users update own negotiations"
    ON public.sales_coach_negotiations FOR UPDATE USING (user_id = auth.uid());

-- Messages: reachable only through a negotiation the caller owns (admins all).
DROP POLICY IF EXISTS "Users read own negotiation messages" ON public.sales_coach_messages;
CREATE POLICY "Users read own negotiation messages"
    ON public.sales_coach_messages FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.sales_coach_negotiations n
                WHERE n.id = negotiation_id
                  AND (n.user_id = auth.uid() OR public.user_role() = 'admin'))
    );
DROP POLICY IF EXISTS "Users insert own negotiation messages" ON public.sales_coach_messages;
CREATE POLICY "Users insert own negotiation messages"
    ON public.sales_coach_messages FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.sales_coach_negotiations n
                WHERE n.id = negotiation_id AND n.user_id = auth.uid())
    );

-- ------------------------------------------------------------
-- 6. AUDIO STORAGE BUCKET (private) — reuses the AssemblyAI pipeline (US-037)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('sales-coach-audio', 'sales-coach-audio', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Object paths are "<user_id>/<negotiation_id>/<file>". Users manage only their
-- own folder; admins may read all. The service role bypasses these for the
-- server-side transcription download.
DROP POLICY IF EXISTS "Users manage own sales coach audio" ON storage.objects;
CREATE POLICY "Users manage own sales coach audio"
    ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'sales-coach-audio' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'sales-coach-audio' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Admins read all sales coach audio" ON storage.objects;
CREATE POLICY "Admins read all sales coach audio"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'sales-coach-audio' AND public.user_role() = 'admin');
