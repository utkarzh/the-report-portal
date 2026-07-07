-- ============================================================
-- 002 — One-device-one-login
-- ============================================================
-- Run this on an EXISTING database that was created from 001 before the
-- one-device-one-login feature. Fresh databases already have the column
-- (it lives in 001_schema.sql). Safe to run more than once.
--
-- `active_session_id` holds the id of the currently-authorised device session.
-- A fresh UUID is written on every successful sign-in and mirrored into the
-- browser's `device_session` cookie. Middleware signs out any device whose
-- cookie doesn't match this column ("newest login wins"). NULL = no device has
-- registered yet, so enforcement is skipped until the user's next sign-in.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS active_session_id UUID;
