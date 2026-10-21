-- ============================================================
-- 041 — Copywriting: section library, per-article section structure,
--       direct / pull quote counts (client request, 20 Oct 2026)
-- ============================================================
-- Run on any database that already ran 032 (Copywriting). Idempotent and
-- SAFE TO RE-RUN. Nothing is dropped.
--
-- • copywriting_sections — the admin-managed library of sections
--   ("HEADLINE", "TEXT", "Closing quote"…): a label plus an optional
--   description telling the AI what the label means ("TEXT" = the article's
--   main body), so it writes the right kind of text in each section.
--   No length: the same section is used by many kinds of article, each
--   needing a different length, so the character count is set per article
--   in the Configure form.
-- • copywriting_projects.sections — that article's ordered structure, a
--   SNAPSHOT: [{ key, section_id, name, description, target_chars }]. Editing or deleting
--   a library section never changes an article already configured (no FK).
-- • copywriting_projects.direct_quotes / pull_quotes — how many of each the
--   article must carry.
-- • copywriting_research_entries.requested_claim — the gap/claim each finding
--   was researched for, so a resolved gap leaves the analysis screen.
--
-- The old free-text section_structure, target_length (words) and
-- quotes_required columns are kept for projects created before this; new
-- projects leave them empty.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.copywriting_sections (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    created_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For a database that ran an earlier copy of this migration (no description).
ALTER TABLE public.copywriting_sections ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- "Introduction" and " introduction " are the same section.
CREATE UNIQUE INDEX IF NOT EXISTS copywriting_sections_name_key
    ON public.copywriting_sections (lower(btrim(name)));

DROP TRIGGER IF EXISTS copywriting_sections_updated_at ON public.copywriting_sections;
CREATE TRIGGER copywriting_sections_updated_at
    BEFORE UPDATE ON public.copywriting_sections
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.copywriting_sections ENABLE ROW LEVEL SECURITY;

-- Any signed-in user reads (the Configure form); only admins write. The app
-- writes through the service role after its own admin check.
DROP POLICY IF EXISTS "Authenticated users can read copywriting sections" ON public.copywriting_sections;
CREATE POLICY "Authenticated users can read copywriting sections"
    ON public.copywriting_sections FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins manage copywriting sections" ON public.copywriting_sections;
CREATE POLICY "Admins manage copywriting sections"
    ON public.copywriting_sections FOR ALL USING (public.user_role() = 'admin');

ALTER TABLE public.copywriting_projects
    ADD COLUMN IF NOT EXISTS sections      JSONB   NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS direct_quotes INTEGER,
    ADD COLUMN IF NOT EXISTS pull_quotes   INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'copywriting_projects_quote_counts_check') THEN
        ALTER TABLE public.copywriting_projects
            ADD CONSTRAINT copywriting_projects_quote_counts_check
            CHECK ((direct_quotes IS NULL OR direct_quotes >= 0) AND (pull_quotes IS NULL OR pull_quotes >= 0));
    END IF;
END $$;

-- Research Ledger: the exact claim/gap text each finding was requested for,
-- so a gap on the analysis screen is removed once its finding is approved or
-- discarded. NULL on findings recorded before this.
ALTER TABLE public.copywriting_research_entries
    ADD COLUMN IF NOT EXISTS requested_claim TEXT;

NOTIFY pgrst, 'reload schema';
