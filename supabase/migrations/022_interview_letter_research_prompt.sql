-- ============================================================
-- 022 — Interview Letter Research Prompt (admin-editable, per company)
-- ============================================================
-- Run this on an EXISTING production database created from an earlier 001.
-- Fresh databases already have everything (merged into 001_schema.sql).
-- Idempotent and SAFE TO RE-RUN — uses IF NOT EXISTS / WHERE NOT EXISTS /
-- DROP POLICY IF EXISTS throughout and never drops or alters existing data.
--
-- Makes the research step (the first stage of every Interview Request
-- Letter project) admin-configurable per company, instead of a single
-- prompt hardcoded in the research route. Mirrors meeting_prep_prompt's
-- versioned-singleton pattern (014_meeting_preparation.sql) — the closest
-- precedent already used by this module — keyed by company instead of a
-- fixed key set, since TRC and GFDI may want different research emphasis.
--
-- Depends on objects already created by 001: public.update_updated_at(),
-- public.user_role(), public.profiles, and the uuid_generate_v4() extension.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.interview_letter_research_prompts (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    company     TEXT        NOT NULL UNIQUE
        CHECK (company IN ('TRC', 'GFDI')),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seeded with the exact text that used to be hardcoded in the research route
-- (RESEARCH_SYSTEM), so behaviour is unchanged until an admin edits it.
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

CREATE INDEX IF NOT EXISTS idx_interview_letter_research_prompts_versions_company_created
    ON public.interview_letter_research_prompts_versions(company, created_at DESC);

ALTER TABLE public.interview_letter_research_prompts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_research_prompts_versions ENABLE ROW LEVEL SECURITY;

-- Same shape as interview_letter_templates: any authenticated user may read
-- (needed at research time), only admins write. Writes from API routes go
-- through the service role, same as every other prompt table in this app.
DROP POLICY IF EXISTS "Authenticated users can read letter research prompts" ON public.interview_letter_research_prompts;
CREATE POLICY "Authenticated users can read letter research prompts"
    ON public.interview_letter_research_prompts FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update letter research prompts" ON public.interview_letter_research_prompts;
CREATE POLICY "Admins can update letter research prompts"
    ON public.interview_letter_research_prompts FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage letter research prompt versions" ON public.interview_letter_research_prompts_versions;
CREATE POLICY "Admins can manage letter research prompt versions"
    ON public.interview_letter_research_prompts_versions FOR ALL USING (public.user_role() = 'admin');
