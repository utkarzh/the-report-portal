-- ============================================================
-- Editorial Research Tool — Full Schema
-- Run this in the Supabase SQL editor on a fresh database.
-- If the database has prior data, run supabase/teardown.sql first.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role    AS ENUM ('admin', 'user');
CREATE TYPE user_status  AS ENUM ('active', 'inactive');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'expired');

-- ============================================================
-- PROFILES (extends auth.users 1:1)
-- ============================================================

CREATE TABLE public.profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    full_name   TEXT,
    role        user_role   NOT NULL DEFAULT 'user',
    status      user_status NOT NULL DEFAULT 'active',
    -- A single research run can cost ~150k tokens (research) and ~2x with
    -- follow-up questions; the default must comfortably exceed one run so the
    -- headroom gate (GENERATION_TOKEN_RESERVE) leaves room to generate.
    -- NULL means "no limit" — admins are never token-limited; normal users
    -- default to 2M.
    token_limit INTEGER     DEFAULT 2000000,
    tokens_used INTEGER     NOT NULL DEFAULT 0,
    -- Per-module access for normal users. Admins always have full access and
    -- ignore these flags (enforced in app code). Interview is on by default;
    -- the transcriptions module is off until an admin enables it.
    can_access_interview      BOOLEAN NOT NULL DEFAULT TRUE,
    can_access_transcriptions BOOLEAN NOT NULL DEFAULT FALSE,
    -- Business Cases / Editorial Briefs modules — off until an admin enables them.
    can_access_business_cases   BOOLEAN NOT NULL DEFAULT FALSE,
    can_access_editorial_briefs BOOLEAN NOT NULL DEFAULT FALSE,
    -- Commercial Meeting Preparation module — off until an admin enables it.
    can_access_meeting_preparation BOOLEAN NOT NULL DEFAULT FALSE,
    -- Interview Request Letter & Email Generator module — off until an admin enables it.
    can_access_interview_letter_generator BOOLEAN NOT NULL DEFAULT FALSE,
    -- Cash Box (finance) module. NULL = no finance access at all. Deliberately
    -- NOT folded into the can_access_* flags above — see migration 017.
    finance_role TEXT CHECK (finance_role IN ('finance_admin', 'field')),
    -- One-device-one-login: the id of the currently-authorised device session.
    -- Set to a fresh UUID on every successful sign-in; the browser stores the
    -- same value in the `device_session` cookie. Middleware signs out any device
    -- whose cookie doesn't match this column ("newest login wins"). NULL means
    -- no device has registered yet (enforcement is skipped until first login).
    active_session_id UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SHARED TRIGGER: updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- INVITATIONS
-- ============================================================

CREATE TABLE public.invitations (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       TEXT        NOT NULL,
    role        user_role   NOT NULL DEFAULT 'user',
    -- NULL means "no limit" (used for admin invites). Normal users default to 2M.
    token_limit INTEGER     DEFAULT 2000000,
    -- Module access carried onto the profile by handle_new_user (see below).
    can_access_interview      BOOLEAN NOT NULL DEFAULT TRUE,
    can_access_transcriptions BOOLEAN NOT NULL DEFAULT FALSE,
    can_access_business_cases   BOOLEAN NOT NULL DEFAULT FALSE,
    can_access_editorial_briefs BOOLEAN NOT NULL DEFAULT FALSE,
    can_access_meeting_preparation BOOLEAN NOT NULL DEFAULT FALSE,
    can_access_interview_letter_generator BOOLEAN NOT NULL DEFAULT FALSE,
    finance_role TEXT CHECK (finance_role IN ('finance_admin', 'field')),
    token       TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    status      invite_status NOT NULL DEFAULT 'pending',
    invited_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    accepted_by UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    accepted_at TIMESTAMPTZ
);

CREATE INDEX idx_invitations_token ON public.invitations(token);
CREATE INDEX idx_invitations_email ON public.invitations(email);

-- ============================================================
-- CATEGORIES
-- ============================================================

CREATE TABLE public.categories (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT        NOT NULL UNIQUE,
    description TEXT,
    prompt_text TEXT        NOT NULL DEFAULT '',
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order  INTEGER     DEFAULT 0,
    created_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- GENERAL PROMPT (singleton row)
-- ============================================================

CREATE TABLE public.general_prompt (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce exactly one row
CREATE UNIQUE INDEX idx_general_prompt_singleton ON public.general_prompt((TRUE));

INSERT INTO public.general_prompt (prompt_text) VALUES (
    'You are an expert editorial research assistant for The Report Company, a leading international business and investment publication. Your role is to produce structured, authoritative, and well-sourced research about interview subjects.

Always maintain a professional, objective tone. Structure your output clearly with labeled sections. Focus on facts that are relevant to business, investment, policy, and leadership. Avoid speculation and clearly indicate when information may be incomplete.'
);

-- ============================================================
-- RESEARCH SESSIONS
-- ============================================================

CREATE TABLE public.research_sessions (
    id                       UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Nullable so sessions are kept for records when a user is deleted (US-011)
    user_id                  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    category_id              UUID        REFERENCES public.categories(id) ON DELETE SET NULL,
    category_name            TEXT        NOT NULL,
    full_name                TEXT,
    title_position           TEXT,
    company_org              TEXT,
    country_focus            TEXT,
    publication              TEXT,
    media_partner_country    TEXT,
    initial_output           TEXT,
    questions_output         TEXT,
    tokens_input             INTEGER     DEFAULT 0,
    tokens_output            INTEGER     DEFAULT 0,
    tokens_total             INTEGER     DEFAULT 0,
    web_searches             INTEGER     DEFAULT 0,  -- billed separately at $0.01/search
    cost_usd                 NUMERIC(10, 6) DEFAULT 0,
    general_prompt_snapshot  TEXT,
    category_prompt_snapshot TEXT,
    -- Generation lifecycle (migration 010): 'pending' | 'generating' | 'complete' | 'failed'.
    -- Lets a user returning mid-run see "Generating…" and reconnect.
    status                   TEXT        NOT NULL DEFAULT 'complete',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_sessions_user_id   ON public.research_sessions(user_id);
CREATE INDEX idx_research_sessions_created_at ON public.research_sessions(created_at);
CREATE INDEX idx_research_sessions_category_id ON public.research_sessions(category_id);

CREATE TRIGGER research_sessions_updated_at
    BEFORE UPDATE ON public.research_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- PROMPT VERSION HISTORY
-- ============================================================

CREATE TABLE public.general_prompt_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_text TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_general_prompt_versions_created_at
    ON public.general_prompt_versions(created_at DESC);

CREATE TABLE public.category_prompt_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID        NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    prompt_text TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_category_prompt_versions_category
    ON public.category_prompt_versions(category_id, created_at DESC);

-- ============================================================
-- LOGIN AUDIT LOGS (admin-only)
-- ============================================================
-- One row per successful sign-in. Written server-side by
-- /api/auth/session-register using the service role. Only admins can read it.
-- user_id is nullable / SET NULL on delete so the trail survives user deletion;
-- email / full_name / user_role are denormalised so deleted users stay legible.

CREATE TABLE public.login_audit_logs (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    email        TEXT        NOT NULL,
    full_name    TEXT,
    user_role    public.user_role,
    ip_address   TEXT,
    location     TEXT,        -- human-readable "City, Region, Country" (best-effort)
    country      TEXT,        -- ISO country name, when resolvable
    user_agent   TEXT,        -- raw User-Agent header
    login_method TEXT,        -- 'password' | 'otp' | NULL
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_audit_logs_created_at ON public.login_audit_logs(created_at DESC);
CREATE INDEX idx_login_audit_logs_user_id    ON public.login_audit_logs(user_id);

-- ============================================================
-- USAGE EVENTS LEDGER (admin-only) — migration 010
-- ============================================================
-- Append-only, one immutable row per Claude call (research, questions,
-- transcript refine/translate). The single source of truth for analytics:
-- counts every regeneration and includes transcription spend. source_id has NO
-- FK so the ledger survives deletion of the underlying item; user_id SET NULL
-- keeps history for deleted users (grouped under "Deleted user").

CREATE TABLE public.usage_events (
    id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
    workflow      TEXT          NOT NULL,   -- 'research' | 'research_questions' | 'transcript_refine' | 'transcript_translate'
    source_id     UUID,                      -- research_sessions.id or transcriptions.id (no FK by design)
    model         TEXT,
    tokens_input  INTEGER       NOT NULL DEFAULT 0,
    tokens_output INTEGER       NOT NULL DEFAULT 0,
    tokens_total  INTEGER       NOT NULL DEFAULT 0,
    web_searches  INTEGER       NOT NULL DEFAULT 0,
    cost_usd      NUMERIC(10, 6) NOT NULL DEFAULT 0,
    status        TEXT          NOT NULL DEFAULT 'success',  -- 'success' | 'error'
    error         TEXT,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_events_created_at ON public.usage_events(created_at DESC);
CREATE INDEX idx_usage_events_user_id    ON public.usage_events(user_id);
CREATE INDEX idx_usage_events_workflow   ON public.usage_events(workflow);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_prompt         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_prompt_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events             ENABLE ROW LEVEL SECURITY;

-- Helper: returns the current user's role (used in RLS policies)
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';

-- Profiles
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Admins can view all profiles"
    ON public.profiles FOR SELECT USING (public.user_role() = 'admin');
CREATE POLICY "Users can update own profile name"
    ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Admins can update any profile"
    ON public.profiles FOR UPDATE USING (public.user_role() = 'admin');
CREATE POLICY "Service role can insert profiles"
    ON public.profiles FOR INSERT WITH CHECK (TRUE);

-- Invitations
CREATE POLICY "Admins can manage invitations"
    ON public.invitations FOR ALL USING (public.user_role() = 'admin');
CREATE POLICY "Anyone can read invitation by token"
    ON public.invitations FOR SELECT USING (TRUE);

-- Categories
CREATE POLICY "Authenticated users can read active categories"
    ON public.categories FOR SELECT TO authenticated USING (is_active = TRUE);
CREATE POLICY "Admins can manage categories"
    ON public.categories FOR ALL USING (public.user_role() = 'admin');

-- General prompt
CREATE POLICY "Authenticated users can read general prompt"
    ON public.general_prompt FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Admins can update general prompt"
    ON public.general_prompt FOR UPDATE USING (public.user_role() = 'admin');

-- Research sessions
CREATE POLICY "Users can read own sessions"
    ON public.research_sessions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can read all sessions"
    ON public.research_sessions FOR SELECT USING (public.user_role() = 'admin');
CREATE POLICY "Users can insert own sessions"
    ON public.research_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own sessions"
    ON public.research_sessions FOR UPDATE USING (user_id = auth.uid());

-- Prompt versions
CREATE POLICY "Admins can manage general prompt versions"
    ON public.general_prompt_versions FOR ALL USING (public.user_role() = 'admin');
CREATE POLICY "Admins can manage category prompt versions"
    ON public.category_prompt_versions FOR ALL USING (public.user_role() = 'admin');

-- Login audit logs — admins read only. Inserts come from the service role.
CREATE POLICY "Admins can read login audit logs"
    ON public.login_audit_logs FOR SELECT USING (public.user_role() = 'admin');

-- Usage events — admins read only. Inserts come from the service role.
CREATE POLICY "Admins can read usage events"
    ON public.usage_events FOR SELECT USING (public.user_role() = 'admin');

-- ============================================================
-- FUNCTION: auto-create profile when a new auth user signs up
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_invite public.invitations%ROWTYPE;
    -- Schema-qualified: this SECURITY DEFINER trigger is fired by the auth
    -- system under a search_path that excludes `public`, so a bare `user_role`
    -- type name would fail to resolve at runtime.
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
        -- Admins get no limit (NULL); normal users fall back to the 2M default.
        CASE WHEN v_role = 'admin' THEN NULL
             ELSE COALESCE(v_invite.token_limit, 2000000) END,
        'active',
        -- Admins always have full access; normal users inherit the invite flags.
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
        -- Platform admins reach finance through role = 'admin' instead — this
        -- column stays NULL for them by design (see canAccessFinance/isFinanceAdmin).
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

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- FUNCTION: increment user tokens atomically
-- ============================================================

CREATE OR REPLACE FUNCTION increment_user_tokens(
    p_user_id UUID,
    p_tokens  INTEGER
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.profiles
    SET tokens_used = tokens_used + p_tokens
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- TRANSCRIPTIONS MODULE
-- ============================================================
-- Also shipped as standalone migration 005_transcriptions.sql for databases
-- that predate this feature. Kept here so a fresh DB from 001 is complete.

-- Refining prompt (singleton, mirrors general_prompt)
CREATE TABLE IF NOT EXISTS public.transcript_prompt (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_prompt_singleton
    ON public.transcript_prompt((TRUE));

INSERT INTO public.transcript_prompt (prompt_text)
SELECT $seed$You are an expert editorial transcript editor for The Report Company. You are given the RAW machine transcript of a recorded interview. It has already been diarized: each turn is prefixed with a speaker label such as "Speaker A:" / "Speaker B:". Produce a clean, readable, publication-ready version of it.

Rules:
- Transcribe word-for-word, exactly as spoken. Preserve each speaker's meaning and all key facts exactly. Never invent or add content that is not in the transcript.
- Fix punctuation and capitalisation, and correct obvious speech-to-text errors — but do not otherwise reword, paraphrase, or trim what was said.
- PRESERVE the speaker labels exactly as given (keep "Speaker A", "Speaker B", etc.), and keep every turn attributed to the same speaker. Do not merge, drop, rename, or guess speakers, and do not invent names. If a passage has no label in the raw transcript, leave it unlabelled.
- Start each speaker turn on its own line in the form "Speaker A: ...". Break long turns into readable paragraphs at natural pauses or topic shifts.
- Keep a professional, faithful editorial tone. Do not summarise or omit substance — this is a verbatim cleaned transcript, not a summary.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.transcript_prompt);

-- Refining prompt version history (mirrors general_prompt_versions)
CREATE TABLE IF NOT EXISTS public.transcript_prompt_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_text TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_prompt_versions_created_at
    ON public.transcript_prompt_versions(created_at DESC);

-- Transcriptions (mirrors research_sessions; user_id nullable + SET NULL keeps history)
CREATE TABLE IF NOT EXISTS public.transcriptions (
    id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    title                     TEXT        NOT NULL DEFAULT 'Untitled transcript',
    audio_path                TEXT        NOT NULL,
    -- Ordered 16kHz-mono chunk paths (ffmpeg.wasm split); NULL = transcribe audio_path directly.
    chunk_paths               TEXT[],
    chunk_transcripts         TEXT[],
    audio_filename            TEXT,
    audio_mime                TEXT,
    audio_size_bytes          BIGINT,
    duration_seconds          NUMERIC,
    status                    TEXT        NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded','transcribing','transcribed','refining','refined','failed')),
    raw_transcript            TEXT,
    refined_transcript        TEXT,
    refining_prompt_snapshot  TEXT,
    -- Optional topic-outline document attached at upload: extracted text (the
    -- file itself is not stored) used as supporting context during refine.
    topic_outline             TEXT,
    topic_outline_filename    TEXT,
    -- Single translation slot (one of: English, German, Spanish, Italian, Russian).
    -- Independent of refining; re-translating overwrites it.
    translated_transcript     TEXT,
    translation_language      TEXT,
    transcribe_model          TEXT,
    -- Provider job id for async transcription (AssemblyAI). NULL for the OpenAI path.
    transcribe_job_id         TEXT,
    tokens_input              INTEGER     DEFAULT 0,
    tokens_output             INTEGER     DEFAULT 0,
    tokens_total              INTEGER     DEFAULT 0,
    cost_usd                  NUMERIC(10, 6) DEFAULT 0,
    error                     TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_user_id   ON public.transcriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON public.transcriptions(created_at DESC);

DROP TRIGGER IF EXISTS transcriptions_updated_at ON public.transcriptions;
CREATE TRIGGER transcriptions_updated_at
    BEFORE UPDATE ON public.transcriptions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.transcript_prompt          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcriptions             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read transcript prompt" ON public.transcript_prompt;
CREATE POLICY "Authenticated users can read transcript prompt"
    ON public.transcript_prompt FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update transcript prompt" ON public.transcript_prompt;
CREATE POLICY "Admins can update transcript prompt"
    ON public.transcript_prompt FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage transcript prompt versions" ON public.transcript_prompt_versions;
CREATE POLICY "Admins can manage transcript prompt versions"
    ON public.transcript_prompt_versions FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Users can read own transcriptions" ON public.transcriptions;
CREATE POLICY "Users can read own transcriptions"
    ON public.transcriptions FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins can read all transcriptions" ON public.transcriptions;
CREATE POLICY "Admins can read all transcriptions"
    ON public.transcriptions FOR SELECT USING (public.user_role() = 'admin');
DROP POLICY IF EXISTS "Users can insert own transcriptions" ON public.transcriptions;
CREATE POLICY "Users can insert own transcriptions"
    ON public.transcriptions FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can update own transcriptions" ON public.transcriptions;
CREATE POLICY "Users can update own transcriptions"
    ON public.transcriptions FOR UPDATE USING (user_id = auth.uid());

-- Storage — private audio bucket + RLS
INSERT INTO storage.buckets (id, name, public)
VALUES ('transcription-audio', 'transcription-audio', FALSE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users manage own transcription audio" ON storage.objects;
CREATE POLICY "Users manage own transcription audio"
    ON storage.objects FOR ALL TO authenticated
    USING (
        bucket_id = 'transcription-audio'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'transcription-audio'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Admins read all transcription audio" ON storage.objects;
CREATE POLICY "Admins read all transcription audio"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'transcription-audio'
        AND public.user_role() = 'admin'
    );

-- ============================================================
-- BUSINESS CASES & EDITORIAL BRIEFS MODULES
-- ============================================================
-- Generic engine keyed by doc_type ('business_case' | 'editorial_brief').
-- Permission flags live on profiles/invitations above; handle_new_user copies
-- them. usage_events.workflow is plain TEXT, so 'business_case' /
-- 'editorial_brief' workflow values need no schema change.

-- Detailed prompt (one singleton row per doc_type).
CREATE TABLE IF NOT EXISTS public.document_prompt (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_type    TEXT        NOT NULL UNIQUE
        CHECK (doc_type IN ('business_case', 'editorial_brief')),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

ALTER TABLE public.document_prompt          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_samples         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_sessions        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read document prompt" ON public.document_prompt;
CREATE POLICY "Authenticated users can read document prompt"
    ON public.document_prompt FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update document prompt" ON public.document_prompt;
CREATE POLICY "Admins can update document prompt"
    ON public.document_prompt FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage document prompt versions" ON public.document_prompt_versions;
CREATE POLICY "Admins can manage document prompt versions"
    ON public.document_prompt_versions FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage document samples" ON public.document_samples;
CREATE POLICY "Admins can manage document samples"
    ON public.document_samples FOR ALL USING (public.user_role() = 'admin');

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

INSERT INTO storage.buckets (id, name, public)
VALUES ('document-samples', 'document-samples', FALSE)
ON CONFLICT (id) DO NOTHING;

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

-- ============================================================
-- INTERVIEW COMPANY DOCUMENTS (migration 013)
-- ============================================================
-- Company documents (annual/sustainability reports, etc.) attached on the
-- "new interview" details screen and fed to Claude as supporting context.
CREATE TABLE IF NOT EXISTS public.research_documents (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id     UUID        NOT NULL REFERENCES public.research_sessions(id) ON DELETE CASCADE,
    user_id        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    filename       TEXT        NOT NULL,
    storage_path   TEXT        NOT NULL,
    mime           TEXT,
    size_bytes     BIGINT,
    extracted_text TEXT        NOT NULL DEFAULT '',
    char_count     INTEGER     DEFAULT 0,
    truncated      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_research_documents_session
    ON public.research_documents(session_id, created_at);

ALTER TABLE public.research_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own research documents" ON public.research_documents;
CREATE POLICY "Users manage own research documents"
    ON public.research_documents FOR ALL USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all research documents" ON public.research_documents;
CREATE POLICY "Admins read all research documents"
    ON public.research_documents FOR SELECT USING (public.user_role() = 'admin');

INSERT INTO storage.buckets (id, name, public)
VALUES ('research-documents', 'research-documents', FALSE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users manage own research documents storage" ON storage.objects;
CREATE POLICY "Users manage own research documents storage"
    ON storage.objects FOR ALL TO authenticated
    USING (
        bucket_id = 'research-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'research-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Admins read all research documents storage" ON storage.objects;
CREATE POLICY "Admins read all research documents storage"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'research-documents'
        AND public.user_role() = 'admin'
    );

-- ============================================================
-- COMMERCIAL MEETING PREPARATION MODULE (migration 014)
-- ============================================================
-- Multi-stage workflow for TRC sales reps: input -> research -> internal
-- validation (invisible) -> user review (per section) -> 3 presentation
-- points (approval gate) -> planteo build-up (approval gate) -> final
-- assembled document. See 014_meeting_preparation.sql for full commentary.

CREATE TABLE IF NOT EXISTS public.meeting_prep_media_library (
    id                         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    publication_name           TEXT        NOT NULL UNIQUE,
    positioning_statement      TEXT        NOT NULL DEFAULT '',
    audience_reach             TEXT        NOT NULL DEFAULT '',
    editorial_narrative_focus  TEXT        NOT NULL DEFAULT '',
    country_of_publication     TEXT        NOT NULL,
    created_by                 UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER meeting_prep_media_library_updated_at
    BEFORE UPDATE ON public.meeting_prep_media_library
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Exactly 2 fixed variants. Appendix A (the approved planteo scripts) is
-- pending delivery from the TRC commercial team, so both rows seed empty.
CREATE TABLE IF NOT EXISTS public.meeting_prep_planteo_library (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant       TEXT        NOT NULL UNIQUE
        CHECK (variant IN ('company_ceo', 'government_official')),
    template_text TEXT        NOT NULL DEFAULT '',
    updated_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.meeting_prep_planteo_library (variant) VALUES ('company_ceo');
INSERT INTO public.meeting_prep_planteo_library (variant) VALUES ('government_official');

CREATE TRIGGER meeting_prep_planteo_library_updated_at
    BEFORE UPDATE ON public.meeting_prep_planteo_library
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS public.meeting_prep_planteo_library_versions (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant       TEXT        NOT NULL
        CHECK (variant IN ('company_ceo', 'government_official')),
    template_text TEXT        NOT NULL,
    saved_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_prep_planteo_versions_variant_created
    ON public.meeting_prep_planteo_library_versions(variant, created_at DESC);

-- One singleton prompt row per stage. Seeded with default text authored from
-- the brief; admins edit/roll back via the shared PromptVersionHistory UI.
CREATE TABLE IF NOT EXISTS public.meeting_prep_prompt (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_key  TEXT        NOT NULL UNIQUE
        CHECK (prompt_key IN ('research', 'presentation_points', 'planteo', 'final_document')),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.meeting_prep_prompt (prompt_key, prompt_text)
VALUES ('research', $seed$You are a senior research analyst at The Report Company preparing a TRC sales representative for a commercial meeting with a company CEO or government official.

Research the interviewee and their organisation using approved sources, oriented toward BOTH editorial compellingness AND commercial readiness to invest in TRC's platform.

Source priority (highest first): company investor relations pages/official filings; major financial press (Financial Times, Bloomberg, Reuters, Wall Street Journal); sector regulators/official statistics bodies; World Bank/IMF/OECD/official trade and investment agencies; reputable sector-specific publications; company-owned marketing materials (context only — flag as unverified if used as evidence).

Recency: financial/market data no older than 24 months; biographical/career information may extend to 5 years; quotes and news no older than 12 months wherever possible. Older data may be included only if it provides essential context, and must be labelled with its date.

Editorial orientation: business-oriented and commercially purposeful throughout. Never surface negative, corrosive or reputationally damaging content. A mildly challenging business fact may be included only if framed constructively and it does not undermine the commercial objective of the meeting.

Every factual claim must carry a visible source. Flag unsourced or low-confidence claims explicitly — never omit them silently.

Produce exactly four sections, each introduced by its own marker line on its own line (no other text on that line), in this exact order:

<<<SECTION:INTERVIEWEE>>>
Professional background and career trajectory; role in growth of the current organisation and (if applicable) previous organisations; stated vision and values; public positions on investment, growth and international markets; awards/recognitions/notable public profile.

<<<SECTION:ORGANISATION>>>
Company size and turnover; growth over time (revenues, headcount, market footprint); market positioning and perception; rank/market share within sector; top-50/top-100 standing and notable awards; competitive edge over main competitors; growth strategy; investment strategy and potential need for external financing or partners; international operations/export activity/expansion plans; ties to the country of publication; anything relevant to TRC's editorial narratives on business and investment.

<<<SECTION:MOTIVATION_PROFILES>>>
Rank ALL relevant commercial motivation profiles from most to least applicable, each with exactly one sentence of evidence from the research. Assess against these six standard profiles: international market access; investment attraction; sector leadership & competitive positioning; nation brand & FDI attraction (Government Officials only); legacy & personal reputation (handle with intelligence — interwoven with business/editorial narrative, never overt); sector/country advocacy. Exclude any profile with no supporting evidence — do not list it as "not applicable."

<<<SECTION:QUOTES_NEWS>>>
2-3 strong, recent, sourced and dated quotes from the interviewee that reveal their ambitions, sector view or international outlook, prioritising quotes usable naturally in conversation. Then 2-3 recent, sourced and dated news items directly relevant to this person or organisation, prioritising a natural "why now" angle for the meeting.

End your response immediately after the QUOTES_NEWS section with no further commentary.$seed$);

INSERT INTO public.meeting_prep_prompt (prompt_key, prompt_text)
VALUES ('presentation_points', $seed$You are drafting 3 presentation points for a TRC sales representative, explaining why TRC wants to feature this CEO or government official, why now, and how they fit the publication's editorial narrative.

Draw EXCLUSIVELY from the approved research and ranked motivation profiles provided — introduce no new facts.

Each of the 3 points must be:
- Genuinely distinct from the other two
- Grounded in the approved research
- Directly relevant to the publication's editorial narrative
- Implicitly tied to one or more of the ranked motivation profiles — the motivation must never be labelled or stated overtly; the sales rep should be activating a motivation without the interviewee feeling sold to
- Phrased in natural, verbal language — something a sales rep can say aloud, not read
- Concise: one to three sentences maximum

Avoid sales/marketing language, generic praise, overloaded statistics, formal/academic phrasing, and any claim not grounded in the approved research.

Return exactly 3 points, each on its own line prefixed with "1. ", "2. ", "3. " — nothing else.$seed$);

INSERT INTO public.meeting_prep_prompt (prompt_key, prompt_text)
VALUES ('planteo', $seed$You are building the planteo (verbal pitch build-up) for a TRC sales representative's meeting, using the approved TRC planteo formula provided for this interviewee's variant (Company CEO or Government Official). You may NOT deviate from or improvise structure outside that approved formula.

Weave the 3 approved presentation points into the planteo structure. Activate the ranked motivation profiles implicitly — the commercial argument must land through the editorial story, never as a direct or overt pitch.

Format as a hybrid: one short opening paragraph of spoken script to set the frame, followed by structured bullet-point cues the sales rep expands verbally. Use facts and data selectively — enough to be credible, not so many it feels like a presentation.

Do not introduce any fact, claim or figure that was not present in the approved research and points. Tone: authoritative but conversational, natural to speak aloud, business-positive. Avoid sales language, generic praise, formal phrasing, and any negative or reputationally sensitive framing.$seed$);

INSERT INTO public.meeting_prep_prompt (prompt_key, prompt_text)
VALUES ('final_document', $seed$Assemble the final Commercial Meeting Preparation document for a TRC sales representative from the approved material provided (advertiser history, research sections, ranked motivation profiles, quotes & news, the 3 approved presentation points, and the approved planteo). Do not introduce any fact not present in that approved material.

Produce a single document, default 3 pages, maximum 4 pages only if the research quality genuinely justifies it — do not pad length; if the research is thin, 2 pages is acceptable.

Structure, in this exact order:
1. Commercial Alert — always first, always visible. If the company previously advertised with TRC: publication, space purchased, approximate period. If not: a brief note confirming no previous advertising history on record, with a prompt to verify manually.
2. Interviewee & Company Snapshot — 5-6 tight bullet points on what matters most for this meeting, not a biography.
3. Motivation Profile Ranking — all relevant profiles ranked most to least applicable, each with one sentence of evidence. Do not repeat these motivations verbatim inside the planteo section.
4. What They've Said Recently — the 2-3 quotes and 2-3 news items, sourced and dated.
5. 3 Presentation Points — written to be spoken, no motivation labels shown.
6. Planteo Build-Up — the opening paragraph plus structured bullet-point cues, verbatim from the approved planteo.

Before finishing, verify silently: every factual claim has a visible source; the Commercial Alert is present and complete; motivation profiles are ranked and evidenced; no motivation is stated overtly; the 3 points are genuinely distinct; all quotes are sourced and dated; no negative or reputationally damaging content is present; tone is conversational and verbal throughout; the document does not exceed 4 pages. Correct anything that fails before ending your response.$seed$);

CREATE TABLE IF NOT EXISTS public.meeting_prep_prompt_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_key  TEXT        NOT NULL
        CHECK (prompt_key IN ('research', 'presentation_points', 'planteo', 'final_document')),
    prompt_text TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_prep_prompt_versions_key_created
    ON public.meeting_prep_prompt_versions(prompt_key, created_at DESC);

-- One row per meeting prep run; the workflow's state machine.
CREATE TABLE IF NOT EXISTS public.meeting_prep_sessions (
    id                            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,

    interviewee_name              TEXT        NOT NULL,
    interviewee_title             TEXT        NOT NULL,
    interviewee_type              TEXT        NOT NULL
        CHECK (interviewee_type IN ('company_ceo', 'government_official')),
    company_org                   TEXT        NOT NULL,
    company_country               TEXT        NOT NULL,
    publication                   TEXT        NOT NULL,
    publication_country           TEXT        NOT NULL,

    media_library_id              UUID        REFERENCES public.meeting_prep_media_library(id) ON DELETE SET NULL,
    media_positioning_snapshot    TEXT,
    media_audience_reach_snapshot TEXT,
    media_narrative_snapshot      TEXT,

    advertiser_history_status     TEXT
        CHECK (advertiser_history_status IN ('yes', 'no', 'not_aware')),
    advertiser_history_details    TEXT,

    -- Keys: interviewee, organisation, motivation_profiles, quotes_news.
    research_sections             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- Array of up to 3 strings.
    presentation_points           JSONB       NOT NULL DEFAULT '[]'::jsonb,

    planteo_output                TEXT,
    final_output                  TEXT,

    research_prompt_snapshot      TEXT,
    points_prompt_snapshot        TEXT,
    planteo_prompt_snapshot       TEXT,
    final_doc_prompt_snapshot     TEXT,
    planteo_library_snapshot      TEXT,

    stage                         TEXT        NOT NULL DEFAULT 'input'
        CHECK (stage IN (
            'input', 'researching', 'awaiting_review',
            'points_generating', 'points_pending',
            'planteo_generating', 'planteo_pending',
            'final_generating', 'complete', 'failed'
        )),
    error                         TEXT,

    tokens_input                  INTEGER     DEFAULT 0,
    tokens_output                 INTEGER     DEFAULT 0,
    tokens_total                  INTEGER     DEFAULT 0,
    web_searches                  INTEGER     DEFAULT 0,
    cost_usd                      NUMERIC(10, 6) DEFAULT 0,

    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_prep_sessions_user_id
    ON public.meeting_prep_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_prep_sessions_created
    ON public.meeting_prep_sessions(created_at DESC);

CREATE TRIGGER meeting_prep_sessions_updated_at
    BEFORE UPDATE ON public.meeting_prep_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.meeting_prep_media_library           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_planteo_library          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_planteo_library_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_prompt                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_prompt_versions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_sessions                 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read media library"
    ON public.meeting_prep_media_library FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Admins can manage media library"
    ON public.meeting_prep_media_library FOR ALL USING (public.user_role() = 'admin');

CREATE POLICY "Authenticated users can read planteo library"
    ON public.meeting_prep_planteo_library FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Admins can update planteo library"
    ON public.meeting_prep_planteo_library FOR UPDATE USING (public.user_role() = 'admin');

CREATE POLICY "Admins can manage planteo library versions"
    ON public.meeting_prep_planteo_library_versions FOR ALL USING (public.user_role() = 'admin');

CREATE POLICY "Authenticated users can read meeting prep prompt"
    ON public.meeting_prep_prompt FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Admins can update meeting prep prompt"
    ON public.meeting_prep_prompt FOR UPDATE USING (public.user_role() = 'admin');

CREATE POLICY "Admins can manage meeting prep prompt versions"
    ON public.meeting_prep_prompt_versions FOR ALL USING (public.user_role() = 'admin');

CREATE POLICY "Users can read own meeting prep sessions"
    ON public.meeting_prep_sessions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can read all meeting prep sessions"
    ON public.meeting_prep_sessions FOR SELECT USING (public.user_role() = 'admin');
CREATE POLICY "Users can insert own meeting prep sessions"
    ON public.meeting_prep_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own meeting prep sessions"
    ON public.meeting_prep_sessions FOR UPDATE USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- Advertiser Tracker (one per-country row; see migration 015)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meeting_prep_advertiser_tracker (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    country     TEXT        NOT NULL UNIQUE,
    filename    TEXT,
    entries     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    row_count   INTEGER     NOT NULL DEFAULT 0,
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER meeting_prep_advertiser_tracker_updated_at
    BEFORE UPDATE ON public.meeting_prep_advertiser_tracker
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.meeting_prep_advertiser_tracker ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read advertiser tracker"
    ON public.meeting_prep_advertiser_tracker FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Admins can manage advertiser tracker"
    ON public.meeting_prep_advertiser_tracker FOR ALL USING (public.user_role() = 'admin');

-- ============================================================
-- CASH BOX (FINANCE) MODULE (see migrations 017-020)
-- ============================================================
-- Reconciled final shape: finance_projects/finance_expenses below already
-- include every column added across 017 (base), 019 (traveler_count,
-- local_currency, logged_by_name, ai_note, sub_line) and 020 (ai_rules) —
-- do not re-run those as separate ALTERs against a fresh install.

-- ------------------------------------------------------------
-- PROJECTS (017 base + 019 traveler_count/local_currency + 020 ai_rules)
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
    traveler_count      INTEGER     NOT NULL DEFAULT 1 CHECK (traveler_count IN (1, 2)),
    local_currency      TEXT        NOT NULL DEFAULT '',
    -- Admin-authored, project-specific rules fed into both AI receipt passes
    -- as strict requirements (see lib/finance-ai.ts). Empty = no extra rules.
    ai_rules            TEXT        NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER finance_projects_updated_at
    BEFORE UPDATE ON public.finance_projects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- PROJECT MEMBERS (017) — exactly one director, N sales reps
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

CREATE UNIQUE INDEX idx_finance_one_director_per_project
    ON public.finance_project_members(project_id) WHERE project_role = 'director';
CREATE INDEX idx_finance_project_members_user
    ON public.finance_project_members(user_id);

-- ------------------------------------------------------------
-- FUNDINGS (017)
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

CREATE INDEX idx_finance_fundings_project
    ON public.finance_fundings(project_id, date_sent);

-- ------------------------------------------------------------
-- RECEIPTS (018) — must exist before finance_expenses.receipt_id
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

CREATE INDEX idx_finance_receipts_project ON public.finance_receipts(project_id);

-- ------------------------------------------------------------
-- WEEKLY CAJA (018) — must exist before finance_expenses.caja_id
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

CREATE TRIGGER finance_cajas_updated_at
    BEFORE UPDATE ON public.finance_cajas
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- EXPENSES + FLAGS
-- (017 base + 018's receipt_id/nights/prior_approval_granted/caja_id
--  + 019's logged_by_name/ai_note/sub_line)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_expenses (
    id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id             UUID        NOT NULL REFERENCES public.finance_projects(id) ON DELETE CASCADE,
    logged_by              UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    -- Snapshotted at logging time, not just a live join — so removing this
    -- person from the project, or deleting their account, never makes their
    -- past expenses show up nameless.
    logged_by_name         TEXT        NOT NULL DEFAULT '',
    category               TEXT        NOT NULL CHECK (category IN (
                                'transport', 'accommodation', 'communications',
                                'other_services', 'printing_office', 'bank_charges'
                            )),
    concept                TEXT        NOT NULL,
    expense_date           DATE        NOT NULL,
    reference              TEXT,
    vendor                 TEXT,
    local_amount           NUMERIC(12, 2) NOT NULL CHECK (local_amount > 0),
    local_currency         TEXT        NOT NULL,
    exchange_rate_used     NUMERIC(12, 6) NOT NULL,
    settlement_amount      NUMERIC(12, 2) NOT NULL CHECK (settlement_amount > 0),
    receipt_file_path      TEXT,
    receipt_id             UUID        REFERENCES public.finance_receipts(id) ON DELETE SET NULL,
    nights                 INTEGER,
    prior_approval_granted BOOLEAN     NOT NULL DEFAULT FALSE,
    caja_id                UUID        REFERENCES public.finance_cajas(id) ON DELETE SET NULL,
    -- The AI's always-present, one-line take on the receipt (see finance-ai.ts).
    ai_note                TEXT,
    sub_line                TEXT,
    status                 TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    rejection_reason       TEXT,
    reviewed_by            UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_finance_expenses_project_status
    ON public.finance_expenses(project_id, status);

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

CREATE INDEX idx_finance_expense_flags_expense
    ON public.finance_expense_flags(expense_id);

-- ------------------------------------------------------------
-- CAJA EVENTS (018)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_caja_events (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    caja_id    UUID        NOT NULL REFERENCES public.finance_cajas(id) ON DELETE CASCADE,
    from_stage TEXT,
    to_stage   TEXT        NOT NULL,
    comment    TEXT,
    actor_id   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_finance_caja_events_caja ON public.finance_caja_events(caja_id, created_at);

-- ------------------------------------------------------------
-- INCIDENTS (018)
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

CREATE INDEX idx_finance_incidents_caja ON public.finance_incidents(caja_id);
CREATE INDEX idx_finance_incident_messages_incident ON public.finance_incident_messages(incident_id, created_at);

-- ------------------------------------------------------------
-- TRANSFERS (018)
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

CREATE INDEX idx_finance_transfers_from ON public.finance_transfers(from_project_id);
CREATE INDEX idx_finance_transfers_to ON public.finance_transfers(to_project_id);

-- ------------------------------------------------------------
-- NOTIFICATIONS (018)
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

CREATE INDEX idx_finance_notifications_user ON public.finance_notifications(user_id, read, created_at DESC);

-- ------------------------------------------------------------
-- HELPER FUNCTIONS (017) — must be created after finance_project_members
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
-- STORAGE — private bucket for funding proofs + receipt images (017)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-receipts', 'finance-receipts', FALSE)
ON CONFLICT (id) DO NOTHING;

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
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.finance_projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_project_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_fundings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_expenses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_expense_flags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_receipts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_cajas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_caja_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_incidents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_incident_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_transfers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_notifications       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance admins manage projects"
    ON public.finance_projects FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read their own projects"
    ON public.finance_projects FOR SELECT
    USING (public.is_finance_project_member(id));

CREATE POLICY "Finance admins manage project members"
    ON public.finance_project_members FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read their own project roster"
    ON public.finance_project_members FOR SELECT
    USING (public.is_finance_project_member(project_id));

CREATE POLICY "Finance admins manage fundings"
    ON public.finance_fundings FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read their own project fundings"
    ON public.finance_fundings FOR SELECT
    USING (public.is_finance_project_member(project_id));

CREATE POLICY "Finance admins manage expenses"
    ON public.finance_expenses FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read their own project expenses"
    ON public.finance_expenses FOR SELECT
    USING (public.is_finance_project_member(project_id));
CREATE POLICY "Members log expenses on their own projects"
    ON public.finance_expenses FOR INSERT
    WITH CHECK (public.is_finance_project_member(project_id) AND logged_by = auth.uid());

CREATE POLICY "Finance admins manage expense flags"
    ON public.finance_expense_flags FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read flags on their own project expenses"
    ON public.finance_expense_flags FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.finance_expenses e
            WHERE e.id = expense_id AND public.is_finance_project_member(e.project_id)
        )
    );

CREATE POLICY "Finance admins manage receipts"
    ON public.finance_receipts FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read their own project receipts"
    ON public.finance_receipts FOR SELECT
    USING (public.is_finance_project_member(project_id));
CREATE POLICY "Members upload receipts on their own projects"
    ON public.finance_receipts FOR INSERT
    WITH CHECK (public.is_finance_project_member(project_id) AND uploaded_by = auth.uid());

CREATE POLICY "Finance admins manage cajas"
    ON public.finance_cajas FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read own project cajas"
    ON public.finance_cajas FOR SELECT USING (public.is_finance_project_member(project_id));
CREATE POLICY "Members manage draft cajas on own projects"
    ON public.finance_cajas FOR INSERT
    WITH CHECK (public.is_finance_project_member(project_id));
CREATE POLICY "Members update own project cajas"
    ON public.finance_cajas FOR UPDATE USING (public.is_finance_project_member(project_id));

CREATE POLICY "Finance admins manage caja events"
    ON public.finance_caja_events FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read own project caja events"
    ON public.finance_caja_events FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.finance_cajas c WHERE c.id = caja_id AND public.is_finance_project_member(c.project_id)));
CREATE POLICY "Members log own project caja events"
    ON public.finance_caja_events FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM public.finance_cajas c WHERE c.id = caja_id AND public.is_finance_project_member(c.project_id)));

CREATE POLICY "Finance admins manage incidents"
    ON public.finance_incidents FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read own project incidents"
    ON public.finance_incidents FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.finance_cajas c WHERE c.id = caja_id AND public.is_finance_project_member(c.project_id)));

CREATE POLICY "Finance admins manage incident messages"
    ON public.finance_incident_messages FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read+post own project incident messages"
    ON public.finance_incident_messages FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.finance_incidents i JOIN public.finance_cajas c ON c.id = i.caja_id
        WHERE i.id = incident_id AND public.is_finance_project_member(c.project_id)
    ));
CREATE POLICY "Members post own project incident messages"
    ON public.finance_incident_messages FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.finance_incidents i JOIN public.finance_cajas c ON c.id = i.caja_id
        WHERE i.id = incident_id AND public.is_finance_project_member(c.project_id)
    ) AND author_id = auth.uid());

CREATE POLICY "Finance admins manage transfers"
    ON public.finance_transfers FOR ALL USING (public.is_finance_admin());
CREATE POLICY "Members read transfers touching their projects"
    ON public.finance_transfers FOR SELECT
    USING (public.is_finance_project_member(from_project_id) OR public.is_finance_project_member(to_project_id));

CREATE POLICY "Users manage their own notifications"
    ON public.finance_notifications FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Finance admins insert notifications"
    ON public.finance_notifications FOR INSERT WITH CHECK (public.is_finance_admin());

-- ============================================================
-- INTERVIEW REQUEST LETTER & EMAIL GENERATOR MODULE (see migration 021)
-- ============================================================

-- ------------------------------------------------------------
-- LETTER TEMPLATES (exactly 2 fixed variants) + version history
-- ------------------------------------------------------------
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
]$seed$::jsonb;

INSERT INTO public.interview_letter_templates (company, structure)
SELECT 'GFDI', $seed$[
  {"key": "salutation", "type": "fixed", "label": "Salutation", "content": "Dear [Recipient],"},
  {"key": "opening", "type": "variable", "label": "Opening / Why-Now Hook", "instructions": "Open by introducing the Global Foreign Direct Investment (GFDI) platform and state the why-now hook — the specific reason this interview request is timely for this recipient right now.", "wordBudget": 60},
  {"key": "publication_context", "type": "variable", "label": "Publication & Media Partner Context", "instructions": "Introduce the media partner publication, its standing, and why this publication is the right platform for the recipient's story.", "wordBudget": 70},
  {"key": "value_proposition", "type": "variable", "label": "Value to the Recipient", "instructions": "Explain what the recipient and their organisation gain from participating — visibility, positioning, audience reached, investment narrative.", "wordBudget": 70},
  {"key": "ask", "type": "variable", "label": "The Ask", "instructions": "Make the specific interview request: format, approximate time commitment, and next step.", "wordBudget": 50},
  {"key": "closing", "type": "fixed", "label": "Closing", "content": "We would be delighted to schedule this at your earliest convenience. Thank you for your consideration.\n\nWarm regards,\nGFDI"}
]$seed$::jsonb;

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

CREATE INDEX idx_interview_letter_templates_versions_company_created
    ON public.interview_letter_templates_versions(company, created_at DESC);

-- ------------------------------------------------------------
-- RESEARCH PROMPT (admin-editable, one versioned singleton per company)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_letter_research_prompts (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    company     TEXT        NOT NULL UNIQUE
        CHECK (company IN ('TRC', 'GFDI')),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.interview_letter_research_prompts (company, prompt_text)
SELECT 'TRC', $seed$You are a research assistant supporting The Report Company's editorial team as they prepare an Interview Request Letter. Research ONLY what the letter needs — a handful of short, sourced, letter-relevant facts about the project country, the media partner, and the commercial/editorial context — not a general company or country dossier.

Actively look for a genuine why-now / event hook (a live publication window, a recent announcement, a regional milestone) even if the user already supplied one — the editor needs something to compare it against. If the user supplied a hook, still search for the strongest alternative; do not simply restate their hook back to them.

Produce exactly two sections, each introduced by its own marker line on its own line (no other text on that line), in this exact order:

<<<HOOK>>>
One to two sentences: the strongest why-now hook you found, written ready to drop into a letter. If the user already supplied a hook and your research didn't surface anything better, refine their hook rather than inventing a new one.

<<<BULLETS>>>
4-8 short bullets (one per line, each starting with "- "), each a single sourced fact relevant to this letter, with an inline markdown source link and date where available.

End your response immediately after the bullets with no further commentary.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.interview_letter_research_prompts WHERE company = 'TRC');

INSERT INTO public.interview_letter_research_prompts (company, prompt_text)
SELECT 'GFDI', $seed$You are a research assistant supporting the Global Foreign Direct Investment (GFDI) editorial team as they prepare an Interview Request Letter. Research ONLY what the letter needs — a handful of short, sourced, letter-relevant facts about the project country, the media partner, and the commercial/editorial context — not a general company or country dossier.

Actively look for a genuine why-now / event hook (a live publication window, a recent announcement, a regional milestone) even if the user already supplied one — the editor needs something to compare it against. If the user supplied a hook, still search for the strongest alternative; do not simply restate their hook back to them.

Produce exactly two sections, each introduced by its own marker line on its own line (no other text on that line), in this exact order:

<<<HOOK>>>
One to two sentences: the strongest why-now hook you found, written ready to drop into a letter. If the user already supplied a hook and your research didn't surface anything better, refine their hook rather than inventing a new one.

<<<BULLETS>>>
4-8 short bullets (one per line, each starting with "- "), each a single sourced fact relevant to this letter, with an inline markdown source link and date where available.

End your response immediately after the bullets with no further commentary.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.interview_letter_research_prompts WHERE company = 'GFDI');

DROP TRIGGER IF EXISTS interview_letter_research_prompts_updated_at ON public.interview_letter_research_prompts;
CREATE TRIGGER interview_letter_research_prompts_updated_at
    BEFORE UPDATE ON public.interview_letter_research_prompts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.interview_letter_research_prompts_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    company     TEXT        NOT NULL
        CHECK (company IN ('TRC', 'GFDI')),
    prompt_text TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interview_letter_research_prompts_versions_company_created
    ON public.interview_letter_research_prompts_versions(company, created_at DESC);

-- ------------------------------------------------------------
-- PROJECTS (one row per run; the workflow state machine)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_letter_projects (
    id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,

    company                     TEXT        NOT NULL
        CHECK (company IN ('TRC', 'GFDI')),
    project_country             TEXT        NOT NULL,
    media_partner               TEXT        NOT NULL,
    media_partner_country       TEXT        NOT NULL DEFAULT '',
    hook_input                  TEXT        NOT NULL DEFAULT '',

    -- `research` is a JSON array of bullet strings, each carrying its own
    -- inline "[Source, date](url)" citation.
    research                    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    hook_ai_suggestion          TEXT,
    confirmed_hook               TEXT,
    hook_source                 TEXT
        CHECK (hook_source IN ('user', 'ai')),

    template_structure_snapshot JSONB,

    -- Array shadowing the template structure: [{key, type, label, content,
    -- status:'pending'|'locked', lastFeedback}]
    paragraphs                  JSONB       NOT NULL DEFAULT '[]'::jsonb,

    master_letter                TEXT,
    master_email                 TEXT,

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

    tokens_input                INTEGER     DEFAULT 0,
    tokens_output                INTEGER     DEFAULT 0,
    tokens_total                 INTEGER     DEFAULT 0,
    web_searches                 INTEGER     DEFAULT 0,
    cost_usd                     NUMERIC(10, 6) DEFAULT 0,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interview_letter_projects_user_id
    ON public.interview_letter_projects(user_id);
CREATE INDEX idx_interview_letter_projects_created
    ON public.interview_letter_projects(created_at DESC);

CREATE TRIGGER interview_letter_projects_updated_at
    BEFORE UPDATE ON public.interview_letter_projects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- PERSONALIZED OUTPUTS — one row per recipient, unlimited per project
-- ------------------------------------------------------------
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

CREATE INDEX idx_interview_letter_personalizations_project
    ON public.interview_letter_personalizations(project_id, created_at DESC);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.interview_letter_templates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_templates_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_research_prompts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_research_prompts_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_personalizations     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read letter templates"
    ON public.interview_letter_templates FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Admins can update letter templates"
    ON public.interview_letter_templates FOR UPDATE USING (public.user_role() = 'admin');

CREATE POLICY "Admins can manage letter template versions"
    ON public.interview_letter_templates_versions FOR ALL USING (public.user_role() = 'admin');

CREATE POLICY "Authenticated users can read letter research prompts"
    ON public.interview_letter_research_prompts FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Admins can update letter research prompts"
    ON public.interview_letter_research_prompts FOR UPDATE USING (public.user_role() = 'admin');

CREATE POLICY "Admins can manage letter research prompt versions"
    ON public.interview_letter_research_prompts_versions FOR ALL USING (public.user_role() = 'admin');

CREATE POLICY "Users can read own letter projects"
    ON public.interview_letter_projects FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can read all letter projects"
    ON public.interview_letter_projects FOR SELECT USING (public.user_role() = 'admin');
CREATE POLICY "Users can insert own letter projects"
    ON public.interview_letter_projects FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own letter projects"
    ON public.interview_letter_projects FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Admins can delete letter projects"
    ON public.interview_letter_projects FOR DELETE USING (public.user_role() = 'admin');

CREATE POLICY "Users can read own project personalizations"
    ON public.interview_letter_personalizations FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.interview_letter_projects p
            WHERE p.id = project_id AND (p.user_id = auth.uid() OR public.user_role() = 'admin')
        )
    );
CREATE POLICY "Users can insert own project personalizations"
    ON public.interview_letter_personalizations FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.interview_letter_projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );
