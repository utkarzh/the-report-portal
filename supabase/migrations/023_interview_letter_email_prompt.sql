-- ============================================================
-- 023 — Interview Letter Email Prompt (admin-editable, per company)
--        + per-project sender identity
-- ============================================================
-- Run this on an EXISTING production database created from an earlier 001.
-- Fresh databases already have everything (merged into 001_schema.sql).
-- Idempotent and SAFE TO RE-RUN — uses IF NOT EXISTS / WHERE NOT EXISTS /
-- DROP POLICY IF EXISTS throughout and never drops or alters existing data.
--
-- The email step used to be a single hardcoded prompt (EMAIL_SYSTEM in
-- src/app/api/interview-letters/[id]/email/route.ts) that instructed Claude
-- to write "a condensed version of the approved letter". Real TRC/GFDI cover
-- emails are a genuinely different document — their own subject-line
-- convention, signed by a different role than the letter, referencing the
-- attached letter, citing prior published examples, and covering scheduling
-- logistics — none of which the letter contains. This migration gives the
-- email step the same admin-editable, versioned, per-company prompt pattern
-- already used for the research step (022_interview_letter_research_prompt.sql),
-- and adds the per-project sender identity (name/title/contact) an editorial
-- user fills in at Screen 1, since the real sender varies project to project
-- and isn't a fixed per-company default.
--
-- Depends on objects already created by 001: public.update_updated_at(),
-- public.user_role(), public.profiles, and the uuid_generate_v4() extension.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EMAIL PROMPT (singleton per company) + version history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_letter_email_prompts (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    company     TEXT        NOT NULL UNIQUE
        CHECK (company IN ('TRC', 'GFDI')),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seeded with a genuine cover-email brief — not a "condense the letter"
-- instruction. The sender identity and project context are supplied in the
-- user message at generation time (see the email route), not hardcoded here.
INSERT INTO public.interview_letter_email_prompts (company, prompt_text)
SELECT 'TRC', $seed$You are drafting the cover email that accompanies an already-approved Interview Request Letter for The Report Company's editorial team — the email a team member sends to a recipient's office, with the formal letter attached separately. This is NOT a condensed version of the letter — it is a shorter, more direct outreach message that stands on its own.

Write a complete, ready-to-send email:
- Subject line as the very first line, formatted "Subject: ...". Make it specific — reference the recipient/organisation, the publication, and the country/report topic (e.g. "ATTN: [Name] | [Publication], [Country] Business Special: Exclusive Interview").
- A brief greeting using a generic placeholder like "Dear [Name],".
- State plainly, in 1-2 short paragraphs, what the report is, which publication it will appear in, and the why-now hook — enough for the recipient to see why this matters right now, without repeating the letter's full narrative.
- Mention that the official interview request letter is attached for reference.
- If prior published examples of this report series exist, reference them briefly as social proof (e.g. links to previous country features) — otherwise omit this rather than inventing examples.
- Cover logistics briefly: how and when the team plans to conduct interviews, and an invitation to coordinate a convenient time.
- Close with a warm, professional sign-off using the sender's name, title, and contact details exactly as supplied — do not invent or omit any of them.

Keep it concise — an email, not a letter. No corporate boilerplate, no repeating the same point twice.

Before writing anything else, output the literal line <<<OUTPUT>>> on its own line, with nothing before it — no greeting, no plan, no explanation. Immediately after that line, write ONLY the email itself.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.interview_letter_email_prompts WHERE company = 'TRC');

INSERT INTO public.interview_letter_email_prompts (company, prompt_text)
SELECT 'GFDI', $seed$You are drafting the cover email that accompanies an already-approved Interview Request Letter for the Global Foreign Direct Investment (GFDI) editorial team — the email a team member sends to a recipient's office, with the formal letter attached separately. This is NOT a condensed version of the letter — it is a shorter, more direct outreach message that stands on its own.

Write a complete, ready-to-send email:
- Subject line as the very first line, formatted "Subject: ...". Make it specific — reference the recipient/organisation, the publication, and the country/report topic (e.g. "ATTN: [Name] | [Publication], [Country] Business Special: Exclusive Interview").
- A brief greeting using a generic placeholder like "Dear [Name],".
- State plainly, in 1-2 short paragraphs, what the report is, which publication it will appear in, and the why-now hook — enough for the recipient to see why this matters right now, without repeating the letter's full narrative.
- Mention that the official interview request letter is attached for reference.
- If prior published examples of this report series exist, reference them briefly as social proof (e.g. links to previous country features) — otherwise omit this rather than inventing examples.
- Cover logistics briefly: how and when the team plans to conduct interviews, and an invitation to coordinate a convenient time.
- Close with a warm, professional sign-off using the sender's name, title, and contact details exactly as supplied — do not invent or omit any of them.

Keep it concise — an email, not a letter. No corporate boilerplate, no repeating the same point twice.

Before writing anything else, output the literal line <<<OUTPUT>>> on its own line, with nothing before it — no greeting, no plan, no explanation. Immediately after that line, write ONLY the email itself.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.interview_letter_email_prompts WHERE company = 'GFDI');

DROP TRIGGER IF EXISTS interview_letter_email_prompts_updated_at ON public.interview_letter_email_prompts;
CREATE TRIGGER interview_letter_email_prompts_updated_at
    BEFORE UPDATE ON public.interview_letter_email_prompts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.interview_letter_email_prompts_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    company     TEXT        NOT NULL
        CHECK (company IN ('TRC', 'GFDI')),
    prompt_text TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_letter_email_prompts_versions_company_created
    ON public.interview_letter_email_prompts_versions(company, created_at DESC);

ALTER TABLE public.interview_letter_email_prompts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_email_prompts_versions ENABLE ROW LEVEL SECURITY;

-- Same shape as interview_letter_research_prompts: any authenticated user may
-- read (needed at email-generation time), only admins write. Writes from API
-- routes go through the service role, same as every other prompt table.
DROP POLICY IF EXISTS "Authenticated users can read letter email prompts" ON public.interview_letter_email_prompts;
CREATE POLICY "Authenticated users can read letter email prompts"
    ON public.interview_letter_email_prompts FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update letter email prompts" ON public.interview_letter_email_prompts;
CREATE POLICY "Admins can update letter email prompts"
    ON public.interview_letter_email_prompts FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage letter email prompt versions" ON public.interview_letter_email_prompts_versions;
CREATE POLICY "Admins can manage letter email prompt versions"
    ON public.interview_letter_email_prompts_versions FOR ALL USING (public.user_role() = 'admin');

-- ------------------------------------------------------------
-- 2. PER-PROJECT SENDER IDENTITY (Screen 1 input)
-- ------------------------------------------------------------
-- The real cover-email sender (name/title/contact) varies by project/reporter
-- rather than being a fixed per-company default, so it's captured as a user
-- input alongside company/project_country/media_partner, not part of the
-- admin-managed email prompt above.
ALTER TABLE public.interview_letter_projects
    ADD COLUMN IF NOT EXISTS sender_name    TEXT NOT NULL DEFAULT '';
ALTER TABLE public.interview_letter_projects
    ADD COLUMN IF NOT EXISTS sender_title   TEXT NOT NULL DEFAULT '';
ALTER TABLE public.interview_letter_projects
    ADD COLUMN IF NOT EXISTS sender_contact TEXT NOT NULL DEFAULT '';
