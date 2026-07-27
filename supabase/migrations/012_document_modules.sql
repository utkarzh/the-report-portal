-- ============================================================
-- 012 — Business Cases & Editorial Briefs modules
-- ============================================================
-- Run this on an EXISTING production database created from an earlier 001.
-- Fresh databases already have everything (merged into 001_schema.sql).
-- Every statement is idempotent and SAFE TO RE-RUN — it uses
-- IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP POLICY IF EXISTS /
-- CREATE OR REPLACE throughout and never drops or alters existing data.
--
-- Two new AI workflows that share one generic engine keyed by `doc_type`:
--   • business_case   — ~8-10 page research doc (uses web search for recent data)
--   • editorial_brief — long 20-30 page document (also uses web search)
--
-- Both are permission-gated exactly like the interview / transcriptions modules.
--
-- What it adds:
--   1. Per-user access flags (profiles + invitations) + handle_new_user copy
--   2. document_prompt           — per-type detailed "source of truth" prompt
--   3. document_prompt_versions  — version history (snapshot-on-save + rollback)
--   4. document_samples          — up to 5 admin-uploaded sample docs per type
--   5. document_sessions         — one row per generation (mirrors research_sessions)
--   6. document-samples          — private Storage bucket + RLS for the sample files
--
-- Depends on objects already created by 001: public.update_updated_at(),
-- public.user_role(), public.profiles, and the uuid_generate_v4() extension.
-- Note: usage_events.workflow is a plain TEXT column with no CHECK constraint,
-- so the new workflow values ('business_case','editorial_brief') need no DDL.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PER-USER MODULE ACCESS
-- ------------------------------------------------------------
-- Adding a column with a constant default is a metadata-only change in
-- Postgres 11+ (no table rewrite) — safe on a live table. Both default FALSE
-- so NO existing user gains access; behaviour is unchanged until an admin
-- explicitly grants it (matches the transcriptions rollout).
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_access_business_cases   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS can_access_editorial_briefs BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS can_access_business_cases   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS can_access_editorial_briefs BOOLEAN NOT NULL DEFAULT FALSE;

-- Re-declare handle_new_user to also copy the two new invite flags onto the new
-- profile. Admins always get full access. CREATE OR REPLACE is safe to re-run.
-- IMPORTANT: this must preserve every existing column it already sets.
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
        can_access_business_cases, can_access_editorial_briefs
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
             ELSE COALESCE(v_invite.can_access_editorial_briefs, FALSE) END
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
-- 2. DETAILED PROMPT (one singleton row per doc_type)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_prompt (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_type    TEXT        NOT NULL UNIQUE
        CHECK (doc_type IN ('business_case', 'editorial_brief')),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed one row per type (only if absent). Dollar-quoted so apostrophes parse.
INSERT INTO public.document_prompt (doc_type, prompt_text)
SELECT 'business_case', $seed$You are a senior research analyst at The Report Company. Produce a concise, decision-ready BUSINESS CASE of roughly 8-10 pages.

Requirements:
- Use STRICTLY RECENT data. Verify current facts with web search; treat anything older than last year as stale unless clearly labelled historical background.
- Structure: executive summary, market context, opportunity, competitive landscape, risks, financials/outlook, and a clear recommendation.
- Cite source URLs (with publication dates where available) for every factual claim about the current situation.
- Where a sample business case has been provided, match its structure, depth, and tone.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.document_prompt WHERE doc_type = 'business_case');

INSERT INTO public.document_prompt (doc_type, prompt_text)
SELECT 'editorial_brief', $seed$You are a senior editor at The Report Company. Produce a LONG, DETAILED EDITORIAL BRIEF of roughly 20-30 pages.

Requirements:
- Be comprehensive and well-structured: background, context, key themes, stakeholders, angles to pursue, supporting evidence, and recommended editorial direction.
- Use recent data where relevant and verify current facts with web search; cite source URLs with dates for current claims.
- Write in a professional editorial voice with clear section headings and depth in each section.
- Where a sample editorial brief has been provided, match its structure, depth, and tone.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.document_prompt WHERE doc_type = 'editorial_brief');

-- ------------------------------------------------------------
-- 3. PROMPT VERSION HISTORY (snapshot-on-save + rollback)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_prompt_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_type    TEXT        NOT NULL
        CHECK (doc_type IN ('business_case', 'editorial_brief')),
    prompt_text TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_prompt_versions_type_created
    ON public.document_prompt_versions(doc_type, created_at DESC);

-- ------------------------------------------------------------
-- 4. SAMPLE DOCUMENTS (up to 5 per doc_type, enforced in app code)
-- ------------------------------------------------------------
-- The file lives in the private 'document-samples' bucket; extracted_text is
-- what actually gets fed to Claude (extraction happens server-side on upload).
CREATE TABLE IF NOT EXISTS public.document_samples (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_type       TEXT        NOT NULL
        CHECK (doc_type IN ('business_case', 'editorial_brief')),
    filename       TEXT        NOT NULL,
    storage_path   TEXT        NOT NULL,
    mime           TEXT,
    size_bytes     BIGINT,
    extracted_text TEXT        NOT NULL DEFAULT '',
    char_count     INTEGER     DEFAULT 0,
    truncated      BOOLEAN     NOT NULL DEFAULT FALSE,
    uploaded_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_samples_type
    ON public.document_samples(doc_type, created_at DESC);

-- ------------------------------------------------------------
-- 5. DOCUMENT SESSIONS (one row per generation; mirrors research_sessions)
-- ------------------------------------------------------------
-- user_id is nullable and SET NULL on profile delete so history survives when
-- an author is permanently deleted (US-011 pattern).
CREATE TABLE IF NOT EXISTS public.document_sessions (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    doc_type           TEXT        NOT NULL
        CHECK (doc_type IN ('business_case', 'editorial_brief')),
    title              TEXT        NOT NULL DEFAULT 'Untitled',
    project_country    TEXT,
    media_partner      TEXT,
    media_country      TEXT,
    additional_context TEXT,
    output             TEXT,
    prompt_snapshot    TEXT,
    tokens_input       INTEGER     DEFAULT 0,
    tokens_output      INTEGER     DEFAULT 0,
    tokens_total       INTEGER     DEFAULT 0,
    web_searches       INTEGER     DEFAULT 0,
    cost_usd           NUMERIC(10, 6) DEFAULT 0,
    -- 'pending' | 'generating' | 'complete' | 'failed'
    status             TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'generating', 'complete', 'failed')),
    error              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_sessions_user_id
    ON public.document_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_document_sessions_type_created
    ON public.document_sessions(doc_type, created_at DESC);

DROP TRIGGER IF EXISTS document_sessions_updated_at ON public.document_sessions;
CREATE TRIGGER document_sessions_updated_at
    BEFORE UPDATE ON public.document_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.document_prompt          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_samples         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_sessions        ENABLE ROW LEVEL SECURITY;

-- Prompt: any authenticated user may read (needed to generate); only admins
-- change it. Writes from API routes go through the service role (bypasses RLS).
DROP POLICY IF EXISTS "Authenticated users can read document prompt" ON public.document_prompt;
CREATE POLICY "Authenticated users can read document prompt"
    ON public.document_prompt FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update document prompt" ON public.document_prompt;
CREATE POLICY "Admins can update document prompt"
    ON public.document_prompt FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage document prompt versions" ON public.document_prompt_versions;
CREATE POLICY "Admins can manage document prompt versions"
    ON public.document_prompt_versions FOR ALL USING (public.user_role() = 'admin');

-- Samples are admin-only (never shown to normal users; the generate route reads
-- them via the service role).
DROP POLICY IF EXISTS "Admins can manage document samples" ON public.document_samples;
CREATE POLICY "Admins can manage document samples"
    ON public.document_samples FOR ALL USING (public.user_role() = 'admin');

-- Sessions: users see/manage their own, admins see all (mirrors research_sessions).
DROP POLICY IF EXISTS "Users can read own document sessions" ON public.document_sessions;
CREATE POLICY "Users can read own document sessions"
    ON public.document_sessions FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins can read all document sessions" ON public.document_sessions;
CREATE POLICY "Admins can read all document sessions"
    ON public.document_sessions FOR SELECT USING (public.user_role() = 'admin');
DROP POLICY IF EXISTS "Users can insert own document sessions" ON public.document_sessions;
CREATE POLICY "Users can insert own document sessions"
    ON public.document_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can update own document sessions" ON public.document_sessions;
CREATE POLICY "Users can update own document sessions"
    ON public.document_sessions FOR UPDATE USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 7. STORAGE — private sample-documents bucket
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('document-samples', 'document-samples', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Object paths are "<user_id>/<uuid>.<ext>". Uploads are admin-only in app code;
-- the folder-scoped policy lets the uploading admin manage their own files, and
-- a second policy lets any admin read every sample file. The service role
-- bypasses these for server-side download/extraction.
DROP POLICY IF EXISTS "Users manage own document samples" ON storage.objects;
CREATE POLICY "Users manage own document samples"
    ON storage.objects FOR ALL TO authenticated
    USING (
        bucket_id = 'document-samples'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'document-samples'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Admins read all document samples" ON storage.objects;
CREATE POLICY "Admins read all document samples"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'document-samples'
        AND public.user_role() = 'admin'
    );
