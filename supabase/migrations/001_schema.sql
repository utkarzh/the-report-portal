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
        can_access_interview, can_access_transcriptions
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
             ELSE COALESCE(v_invite.can_access_transcriptions, FALSE) END
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
