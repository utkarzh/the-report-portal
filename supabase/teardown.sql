-- ============================================================
-- Editorial Research Tool — TEARDOWN
-- ============================================================
-- ⚠️  DESTRUCTIVE — wipes the database to a clean slate.
-- Run this ONCE in the Supabase SQL editor, then run
-- migrations/001_schema.sql to recreate everything.
--
-- This drops:
--   • all public tables (including the removed `messages` table
--     and any leftover legacy objects from older schema runs)
--   • all custom functions, enums, and triggers
--   • all rows from auth.users (cascades to profiles)
-- ============================================================

-- Drop tables — CASCADE removes their indexes, RLS policies, and triggers.
DROP TABLE IF EXISTS public.category_prompt_versions  CASCADE;
DROP TABLE IF EXISTS public.general_prompt_versions   CASCADE;
DROP TABLE IF EXISTS public.messages                  CASCADE;  -- legacy: refinement chat (removed)
DROP TABLE IF EXISTS public.research_sessions         CASCADE;
DROP TABLE IF EXISTS public.general_prompt            CASCADE;
DROP TABLE IF EXISTS public.categories                CASCADE;
DROP TABLE IF EXISTS public.invitations               CASCADE;
DROP TABLE IF EXISTS public.profiles                  CASCADE;

-- Drop functions — CASCADE removes dependent triggers like on_auth_user_created.
DROP FUNCTION IF EXISTS public.handle_new_user()                                          CASCADE;
DROP FUNCTION IF EXISTS public.user_role()                                                CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at()                                        CASCADE;
DROP FUNCTION IF EXISTS public.increment_user_tokens(UUID, INTEGER)                       CASCADE;
DROP FUNCTION IF EXISTS public.increment_session_tokens(UUID, INTEGER, INTEGER, NUMERIC)  CASCADE;  -- legacy

-- Drop enums.
DROP TYPE IF EXISTS user_role    CASCADE;
DROP TYPE IF EXISTS user_status  CASCADE;
DROP TYPE IF EXISTS invite_status CASCADE;
DROP TYPE IF EXISTS message_role CASCADE;  -- legacy

-- Wipe Supabase auth users. Comment this line out if you want to keep
-- existing logins and only reset the application data.
DELETE FROM auth.users;
