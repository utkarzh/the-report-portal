-- ============================================================
-- 040 — Interview Tool: web research engine setting (client request,
--       19 Oct 2026)
-- ============================================================
-- Run on any database that already ran 001 and 010. Idempotent and SAFE TO
-- RE-RUN — IF NOT EXISTS / ON CONFLICT / DROP ... IF EXISTS throughout; never
-- drops or rewrites existing data.
--
-- What it adds:
--   1. research_settings — singleton admin config for the Interview Tool
--      (Interview Tool → Admin tools → Research engine). research_provider
--      picks who does the web research behind Background Research:
--        'claude' (the default) — Claude's web_search tool, as before;
--        'gemini' — Gemini with Google Search grounding gathers dated,
--                   sourced facts and Claude writes the research from them.
--      Claude writes the research and the interview questions either way.
--   2. research_sessions.research_provider — which engine did the web
--      research behind the session's current Background Research. NULL for
--      research generated before this migration (all of it Claude). Not
--      backfilled, because research_sessions has an updated_at trigger.
--
-- The app works before this runs: research stays on Claude and the admin
-- page says the migration is needed.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.research_settings (
    id                INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    research_provider TEXT        NOT NULL DEFAULT 'claude'
        CHECK (research_provider IN ('claude', 'gemini')),
    updated_by        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.research_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS research_settings_updated_at ON public.research_settings;
CREATE TRIGGER research_settings_updated_at
    BEFORE UPDATE ON public.research_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.research_sessions
    ADD COLUMN IF NOT EXISTS research_provider TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'research_sessions_research_provider_check') THEN
        ALTER TABLE public.research_sessions
            ADD CONSTRAINT research_sessions_research_provider_check
            CHECK (research_provider IS NULL OR research_provider IN ('claude', 'gemini'));
    END IF;
END $$;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
-- The app reads and writes the setting through the service role after its
-- own admin check; this policy only matters for direct client access.
ALTER TABLE public.research_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage research settings" ON public.research_settings;
CREATE POLICY "Admins can manage research settings"
    ON public.research_settings FOR ALL USING (public.user_role() = 'admin');
