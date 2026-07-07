-- ============================================================
-- 004 — Login audit logs (admin-only)
-- ============================================================
-- Run this on an EXISTING database created from 001 before this feature.
-- Fresh databases already have the table (it lives in 001_schema.sql once
-- merged). Safe to run more than once.
--
-- Records one row per successful sign-in: who, when, from which IP / location,
-- and on which device. Written server-side by /api/auth/session-register (the
-- endpoint every successful login already calls) using the service role, so it
-- bypasses RLS on insert. Only admins can read it.
--
-- user_id is nullable and SET NULL on profile delete so the audit trail is kept
-- when a user is permanently deleted (same policy as research_sessions).
-- email / full_name / user_role are denormalised onto the row so a deleted
-- user's history is still legible.

CREATE TABLE IF NOT EXISTS public.login_audit_logs (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    email       TEXT        NOT NULL,
    full_name   TEXT,
    user_role   public.user_role,
    ip_address  TEXT,
    location    TEXT,        -- human-readable "City, Region, Country" (best-effort)
    country     TEXT,        -- ISO country name, when resolvable
    user_agent  TEXT,        -- raw User-Agent header
    login_method TEXT,       -- 'password' | 'otp' | NULL
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_audit_logs_created_at
    ON public.login_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_audit_logs_user_id
    ON public.login_audit_logs(user_id);

ALTER TABLE public.login_audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins may read the audit trail. Inserts are done by the service role
-- (session-register), which bypasses RLS, so no insert policy is needed.
DROP POLICY IF EXISTS "Admins can read login audit logs" ON public.login_audit_logs;
CREATE POLICY "Admins can read login audit logs"
    ON public.login_audit_logs FOR SELECT USING (public.user_role() = 'admin');
