-- ============================================================
-- Editorial Research Tool — Full Schema
-- Run this in the Supabase SQL editor on a fresh database.
-- Safe to re-run: drops all existing objects first.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- CLEAN SLATE — drop everything from any prior partial run
-- ============================================================

DROP TABLE IF EXISTS public.category_prompt_versions  CASCADE;
DROP TABLE IF EXISTS public.general_prompt_versions   CASCADE;
DROP TABLE IF EXISTS public.messages                  CASCADE;
DROP TABLE IF EXISTS public.research_sessions         CASCADE;
DROP TABLE IF EXISTS public.general_prompt            CASCADE;
DROP TABLE IF EXISTS public.categories                CASCADE;
DROP TABLE IF EXISTS public.invitations               CASCADE;
DROP TABLE IF EXISTS public.profiles                  CASCADE;

DROP FUNCTION IF EXISTS public.handle_new_user()           CASCADE;
DROP FUNCTION IF EXISTS public.user_role()                 CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at()         CASCADE;
DROP FUNCTION IF EXISTS public.increment_user_tokens(UUID, INTEGER) CASCADE;

DROP TYPE IF EXISTS user_role    CASCADE;
DROP TYPE IF EXISTS user_status  CASCADE;
DROP TYPE IF EXISTS invite_status CASCADE;
DROP TYPE IF EXISTS message_role CASCADE;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role    AS ENUM ('admin', 'user');
CREATE TYPE user_status  AS ENUM ('active', 'inactive');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'expired');
CREATE TYPE message_role AS ENUM ('user', 'assistant');

-- ============================================================
-- PROFILES (extends auth.users 1:1)
-- ============================================================

CREATE TABLE public.profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    full_name   TEXT,
    role        user_role   NOT NULL DEFAULT 'user',
    status      user_status NOT NULL DEFAULT 'active',
    token_limit INTEGER     NOT NULL DEFAULT 100000,
    tokens_used INTEGER     NOT NULL DEFAULT 0,
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
    token_limit INTEGER     NOT NULL DEFAULT 100000,
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
    tokens_input             INTEGER     DEFAULT 0,
    tokens_output            INTEGER     DEFAULT 0,
    tokens_total             INTEGER     DEFAULT 0,
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
-- MESSAGES (chat refinement per session)
-- ============================================================

CREATE TABLE public.messages (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id   UUID        NOT NULL REFERENCES public.research_sessions(id) ON DELETE CASCADE,
    role         message_role NOT NULL,
    content      TEXT        NOT NULL,
    tokens_input  INTEGER    DEFAULT 0,
    tokens_output INTEGER    DEFAULT 0,
    cost_usd     NUMERIC(10, 6) DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_session_id ON public.messages(session_id);

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
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_prompt         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_prompt_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_prompt_versions ENABLE ROW LEVEL SECURITY;

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

-- Messages
CREATE POLICY "Users can manage messages in own sessions"
    ON public.messages FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.research_sessions
            WHERE id = messages.session_id AND user_id = auth.uid()
        )
    );
CREATE POLICY "Admins can read all messages"
    ON public.messages FOR SELECT USING (public.user_role() = 'admin');

-- Prompt versions
CREATE POLICY "Admins can manage general prompt versions"
    ON public.general_prompt_versions FOR ALL USING (public.user_role() = 'admin');
CREATE POLICY "Admins can manage category prompt versions"
    ON public.category_prompt_versions FOR ALL USING (public.user_role() = 'admin');

-- ============================================================
-- FUNCTION: auto-create profile when a new auth user signs up
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_invite public.invitations%ROWTYPE;
BEGIN
    SELECT * INTO v_invite
    FROM public.invitations
    WHERE email     = NEW.email
      AND status    = 'pending'
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;

    INSERT INTO public.profiles (id, email, full_name, role, token_limit, status)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        COALESCE(v_invite.role, 'user'),
        COALESCE(v_invite.token_limit, 100000),
        'active'
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
