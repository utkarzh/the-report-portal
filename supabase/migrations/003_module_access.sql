-- ============================================================
-- 003 — Per-user module access (Interview Tool / Transcriptions)
-- ============================================================
-- Run this on an EXISTING production database created from 001 before this
-- feature. Fresh databases already have these columns (they live in
-- 001_schema.sql). Safe to run more than once.
--
-- Normal users can be granted access to individual modules. Admins always have
-- full access (these flags are ignored for admins, enforced in app code).
--
-- Defaults are chosen so this migration is a no-op for existing behaviour:
--   • can_access_interview      DEFAULT TRUE  — every current user keeps the
--     interview tool they already use.
--   • can_access_transcriptions DEFAULT FALSE — the (upcoming) transcriptions
--     module stays off until an admin explicitly enables it.
--
-- Adding a column with a constant default is a metadata-only change in
-- Postgres 11+ (no full table rewrite), so this is safe to run on a live table.

-- Per-user access on the profile row.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_access_interview      BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS can_access_transcriptions BOOLEAN NOT NULL DEFAULT FALSE;

-- The chosen access travels on the invitation so it's applied automatically
-- when the invited user's profile is created by the handle_new_user trigger.
ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS can_access_interview      BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS can_access_transcriptions BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- Update the signup trigger to copy the invitation's module access onto the
-- new profile. Admins always get full access regardless of the invite.
-- CREATE OR REPLACE is safe to re-run.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_invite public.invitations%ROWTYPE;
    -- Schema-qualified: this SECURITY DEFINER trigger is fired by the auth
    -- system under a search_path that excludes `public`, so a bare `user_role`
    -- type name would fail to resolve at runtime ("Database error creating new
    -- user"). Everything the function touches must be schema-qualified.
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
