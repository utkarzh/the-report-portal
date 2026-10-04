-- ============================================================
-- 032 — AI Copywriting Tool module (complete)
-- ============================================================
-- The whole Copywriting Tool schema in one file (it merges what were, during
-- development, three local migrations: module, prompt version labels, and
-- image slots). Written for a FRESH database: run it after 001_schema.sql and
-- 025–031, in order. Idempotent (IF NOT EXISTS / WHERE NOT EXISTS / DROP
-- POLICY IF EXISTS / CREATE OR REPLACE).
--
-- TRC editorial writers build a full article (Corporate Profile, Sector
-- Introduction, etc.) through a guided multi-stage workflow — upload sources
-- -> analyze sources & style -> research gaps (via Gemini, cross-checked
-- against outside sources) -> plan -> draft -> automated checks -> revision
-- chat -> final approve -> export (Word / PDF, with uploaded photos placed in
-- the article's image slots). Modeled on the Commercial Meeting Preparation
-- module (014): a per-user access flag, admin-managed reference data
-- (publications, article types, TRC guides), versioned stage prompts with
-- major.minor labels, and one state-machine row per project carrying the
-- whole workflow.
--
-- Depends on 001: update_updated_at(), user_role(), profiles, invitations,
-- uuid_generate_v4(); and 025–029's profile flags (re-declared below in
-- handle_new_user).
-- ============================================================

-- ------------------------------------------------------------
-- 1. PER-USER MODULE ACCESS — same pattern as every other module
-- ------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_access_copywriting_tool BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS can_access_copywriting_tool BOOLEAN NOT NULL DEFAULT FALSE;

-- Re-declare handle_new_user to also copy the new invite flag. Preserves every
-- column it already sets (up to migration 029) — CREATE OR REPLACE, safe to re-run.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_invite public.invitations%ROWTYPE;
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
        can_access_interview, can_access_transcriptions,
        can_access_business_cases, can_access_editorial_briefs,
        can_access_meeting_preparation, finance_role,
        can_access_interview_letter_generator,
        can_access_sales_negotiation_coach,
        can_access_copywriting_tool
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        v_role,
        CASE WHEN v_role = 'admin' THEN NULL
             ELSE COALESCE(v_invite.token_limit, 2000000) END,
        'active',
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_interview, TRUE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_transcriptions, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_business_cases, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_editorial_briefs, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_meeting_preparation, FALSE) END,
        CASE WHEN v_role = 'admin' THEN NULL
             ELSE v_invite.finance_role END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_interview_letter_generator, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_sales_negotiation_coach, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_copywriting_tool, FALSE) END
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

-- ------------------------------------------------------------
-- 2. PUBLICATIONS (admin reference data) + optional guide attachments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_publications (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name              TEXT        NOT NULL UNIQUE,
    country            TEXT,
    additional_rules  TEXT        NOT NULL DEFAULT '',
    created_by        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS copywriting_publications_updated_at ON public.copywriting_publications;
CREATE TRIGGER copywriting_publications_updated_at
    BEFORE UPDATE ON public.copywriting_publications
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Optional publication style-guide attachments (.pdf / .docx). A publication
-- can have zero or more.
CREATE TABLE IF NOT EXISTS public.copywriting_publication_guides (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    publication_id UUID        NOT NULL REFERENCES public.copywriting_publications(id) ON DELETE CASCADE,
    filename       TEXT        NOT NULL,
    storage_path   TEXT        NOT NULL,
    extracted_text TEXT        NOT NULL DEFAULT '',
    char_count     INTEGER     DEFAULT 0,
    truncated      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_by     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copywriting_publication_guides_pub
    ON public.copywriting_publication_guides(publication_id, created_at);

-- ------------------------------------------------------------
-- 3. ARTICLE TYPES (admin reference data)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_article_types (
    id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                      TEXT        NOT NULL UNIQUE,
    additional_instructions   TEXT        NOT NULL DEFAULT '',
    created_by                UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS copywriting_article_types_updated_at ON public.copywriting_article_types;
CREATE TRIGGER copywriting_article_types_updated_at
    BEFORE UPDATE ON public.copywriting_article_types
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Seed the client-supplied fixed list of article types (idempotent — only
-- inserts names not already present, so an admin rename/delete is never
-- clobbered by re-running this migration).
INSERT INTO public.copywriting_article_types (name)
SELECT v.name FROM (VALUES
    ('Corporate profile (Q&A/interview format)'),
    ('Corporate profile (article)'),
    ('Corporate profile (combined article+Q&A)'),
    ('Main introduction'),
    ('Sector Introduction'),
    ('Why Invest'),
    ('Prime Minister/Minister interview'),
    ('Image-led tourism article'),
    ('Leading voices/CEO voices/Government voices'),
    ('Infographic')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM public.copywriting_article_types t WHERE t.name = v.name);

-- ------------------------------------------------------------
-- 4. TRC GUIDES — associated with an article type (not a publication).
--    kind: 'guide' (style/structure guide) or 'example' (worked example).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_trc_guides (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    article_type_id UUID        NOT NULL REFERENCES public.copywriting_article_types(id) ON DELETE CASCADE,
    kind            TEXT        NOT NULL CHECK (kind IN ('guide', 'example')),
    filename        TEXT        NOT NULL,
    storage_path    TEXT        NOT NULL,
    extracted_text  TEXT        NOT NULL DEFAULT '',
    char_count      INTEGER     DEFAULT 0,
    truncated       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copywriting_trc_guides_type
    ON public.copywriting_trc_guides(article_type_id, kind, created_at);

-- ------------------------------------------------------------
-- 5. STAGE PROMPTS (one singleton row per stage) + version history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_prompt (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_key  TEXT        NOT NULL UNIQUE
        CHECK (prompt_key IN (
            'analyze_sources_styles', 'research', 'planning', 'drafting',
            'check', 'revision'
        )),
    prompt_text TEXT        NOT NULL DEFAULT '',
    -- Human-facing "major.minor" label ("0.0", "0.1", "1.0", …). Every prompt
    -- starts at 0.0; on save the admin picks "minor update" (0.1 → 0.2) or
    -- "new major version" (0.2 → 1.0) and the API computes the next label
    -- (nextPromptVersion() in src/lib/copywriting.ts).
    prompt_version TEXT     NOT NULL DEFAULT '0.0'
        CONSTRAINT copywriting_prompt_version_format CHECK (prompt_version ~ '^[0-9]+\.[0-9]+$'),
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.copywriting_prompt (prompt_key, prompt_text)
SELECT 'analyze_sources_styles', $seed$You are a senior editor at The Report Company (TRC). Read every uploaded source document (interview transcripts, press releases, company/government material, supporting documents, and any writer instructions) plus the TRC style guides, worked examples, and publication guide provided for this article.

Produce your analysis as clearly separated sections, each introduced by its own marker line on its own line (no other text on that line):

<<<SECTION:STYLE_THEME>>>
Describe the tone, structure and stylistic approach this article should follow, drawing on the TRC guides/examples for this article type and the publication's own rules.

<<<SECTION:RULES>>>
List the concrete editorial rules that apply (publication additional rules, TRC guide rules, banned words/phrases, formatting requirements) as a bullet list.

<<<SECTION:QUOTABLE_LINES>>>
Extract the strongest directly quotable lines from the source material, verbatim, each with its speaker/source noted.

<<<SECTION:FACTS>>>
List the key verified facts extracted from the source material, each with its source noted.

<<<SECTION:GAPS>>>
List every information gap: a fact the article will need that is NOT present or NOT sufficiently supported in the uploaded sources. Be specific about what is missing and why it matters for this article.

End your response immediately after the GAPS section with no further commentary.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.copywriting_prompt WHERE prompt_key = 'analyze_sources_styles');

INSERT INTO public.copywriting_prompt (prompt_key, prompt_text)
SELECT 'research', $seed$You are a fact-checking research assistant. You are given a specific claim or information gap that needs verification from approved outside sources.

For each item, return: the fact itself, a link to the source, the publication date, any caveats, and a confidence level (high/medium/low). Only use reputable, verifiable outside sources — never fabricate a source or a figure. If nothing reliable can be found, say so explicitly rather than guessing.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.copywriting_prompt WHERE prompt_key = 'research');

INSERT INTO public.copywriting_prompt (prompt_key, prompt_text)
SELECT 'planning', $seed$Using the approved source material and any verified, approved research, propose a plan for this article: its thesis, its overall structure, what each paragraph will cover, where quotes will sit, where research will be used, and how the target length is split across sections.

Ground every element of the plan in the approved material only — do not introduce new facts. Respect the requested section structure, target length and number of required quotes.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.copywriting_prompt WHERE prompt_key = 'planning');

INSERT INTO public.copywriting_prompt (prompt_key, prompt_text)
SELECT 'drafting', $seed$Write a complete first draft of this article using the approved plan, the uploaded sources, the verified and approved research, and every applicable editorial rule (publication rules, TRC guides, style/theme, banned words).

Match the requested target length and number of quotes as closely as possible. Use quotes exactly as they appear in the source material — never alter a direct quote. If you identify a new information gap while drafting, flag it clearly at the end of the draft under a "FLAGGED GAPS" heading rather than guessing.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.copywriting_prompt WHERE prompt_key = 'drafting');

INSERT INTO public.copywriting_prompt (prompt_key, prompt_text)
SELECT 'check', $seed$Check the draft article against the following, and report the results as a structured list of pass/fail/warning items with a short explanation for each:
- Word/length count against the requested target length
- Whether every quote matches the original source exactly
- Any banned words or phrases (per the publication's additional rules and TRC guides)
- Publication-specific formatting rules
- Correct sourcing for every factual claim
- Overall internal consistency (no contradictions)

Be precise and specific — name the exact sentence or quote where a problem was found.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.copywriting_prompt WHERE prompt_key = 'check');

INSERT INTO public.copywriting_prompt (prompt_key, prompt_text)
SELECT 'revision', $seed$You are continuing to work on this article draft with the writer inside a normal conversation. Apply exactly what they ask for — cuts, restructuring, a change of tone, a fact re-check — and return the FULL revised draft, not just the changed portion, unless they explicitly ask for a partial excerpt.

If you notice a new information gap while revising, flag it clearly and suggest further research rather than guessing or inventing a fact.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.copywriting_prompt WHERE prompt_key = 'revision');

CREATE TABLE IF NOT EXISTS public.copywriting_prompt_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_key  TEXT        NOT NULL
        CHECK (prompt_key IN (
            'analyze_sources_styles', 'research', 'planning', 'drafting',
            'check', 'revision'
        )),
    prompt_text TEXT        NOT NULL,
    -- The label the prompt had when this snapshot was taken.
    prompt_version TEXT     NOT NULL DEFAULT '0.0'
        CONSTRAINT copywriting_prompt_versions_version_format CHECK (prompt_version ~ '^[0-9]+\.[0-9]+$'),
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copywriting_prompt_versions_key_created
    ON public.copywriting_prompt_versions(prompt_key, created_at DESC);

-- ------------------------------------------------------------
-- 6. PROJECTS — one row per article, the workflow state machine
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_projects (
    id                       UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    draft_name               TEXT        NOT NULL,

    publication_id           UUID        REFERENCES public.copywriting_publications(id) ON DELETE SET NULL,
    publication_name         TEXT        NOT NULL DEFAULT '',
    article_type_id          UUID        REFERENCES public.copywriting_article_types(id) ON DELETE SET NULL,
    article_type_name        TEXT        NOT NULL DEFAULT '',

    editorial_objective      TEXT        NOT NULL DEFAULT '',
    section_structure        TEXT        NOT NULL DEFAULT '',
    target_length            INTEGER,
    quotes_required          INTEGER,
    -- Number of photos: NULL = the AI decides from the prompts/guides whether
    -- the article needs any and how many, 0 = none, N = exactly N. Drafts mark
    -- each with a numbered "[IMAGE n: description]" placeholder.
    image_count              INTEGER
        CHECK (image_count IS NULL OR (image_count >= 0 AND image_count <= 20)),

    stage                    TEXT        NOT NULL DEFAULT 'upload'
        CHECK (stage IN (
            'upload', 'analyzing', 'analysis_review', 'plan_generating',
            'plan_review', 'drafting', 'draft_review', 'complete', 'failed'
        )),
    error                    TEXT,

    -- Analysis stage output: { style_theme: {text}, rules: {text, approved},
    -- quotable_lines: {text, approved}, facts: {text, approved},
    -- gaps: {text, approved} }
    analysis                 JSONB,
    analysis_prompt_snapshot TEXT,

    -- Plan stage output (one markdown blob the writer approves/requests changes on).
    plan_output              TEXT,
    plan_prompt_snapshot     TEXT,
    plan_status              TEXT        NOT NULL DEFAULT 'pending'
        CHECK (plan_status IN ('pending', 'approved')),

    draft_text               TEXT,
    draft_prompt_snapshot    TEXT,

    checks                   JSONB,
    checks_run_at            TIMESTAMPTZ,

    final_output             TEXT,
    final_approved_at        TIMESTAMPTZ,

    tokens_input             INTEGER     DEFAULT 0,
    tokens_output            INTEGER     DEFAULT 0,
    tokens_total             INTEGER     DEFAULT 0,
    web_searches             INTEGER     DEFAULT 0,
    cost_usd                 NUMERIC(10, 6) DEFAULT 0,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copywriting_projects_user    ON public.copywriting_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_copywriting_projects_created ON public.copywriting_projects(created_at DESC);

DROP TRIGGER IF EXISTS copywriting_projects_updated_at ON public.copywriting_projects;
CREATE TRIGGER copywriting_projects_updated_at
    BEFORE UPDATE ON public.copywriting_projects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 7. SOURCE DOCUMENTS uploaded per project (Step: Upload)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_project_documents (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id     UUID        NOT NULL REFERENCES public.copywriting_projects(id) ON DELETE CASCADE,
    user_id        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    filename       TEXT        NOT NULL,
    storage_path   TEXT        NOT NULL,
    mime           TEXT,
    size_bytes     BIGINT,
    extracted_text TEXT        NOT NULL DEFAULT '',
    char_count     INTEGER     DEFAULT 0,
    truncated      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copywriting_project_documents_project
    ON public.copywriting_project_documents(project_id, created_at);

-- ------------------------------------------------------------
-- 7b. IMAGE SLOTS — one row per filled "[IMAGE n: …]" slot in an article.
--     Keyed by slot NUMBER, not placeholder text, so a revision that rewrites
--     a placeholder's description keeps the photo already placed there. The
--     file lives in the private copywriting-images bucket (JPG/PNG only — the
--     formats the Word/PDF exports can embed; WebP is converted client-side).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_project_images (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id   UUID        NOT NULL REFERENCES public.copywriting_projects(id) ON DELETE CASCADE,
    user_id      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    slot         INTEGER     NOT NULL CHECK (slot >= 1),
    filename     TEXT        NOT NULL,
    storage_path TEXT        NOT NULL,
    mime         TEXT,
    size_bytes   BIGINT,
    width        INTEGER,
    height       INTEGER,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, slot)
);

DROP TRIGGER IF EXISTS copywriting_project_images_updated_at ON public.copywriting_project_images;
CREATE TRIGGER copywriting_project_images_updated_at
    BEFORE UPDATE ON public.copywriting_project_images
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 8. RESEARCH LEDGER — every Gemini-checked fact, permanently attached
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_research_entries (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id       UUID        NOT NULL REFERENCES public.copywriting_projects(id) ON DELETE CASCADE,
    claim            TEXT        NOT NULL,
    source_url       TEXT,
    publication_date TEXT,
    period_covered   TEXT,
    confidence       TEXT,
    caveats          TEXT,
    placement        TEXT,
    status           TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    checked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copywriting_research_entries_project
    ON public.copywriting_research_entries(project_id, created_at);

DROP TRIGGER IF EXISTS copywriting_research_entries_updated_at ON public.copywriting_research_entries;
CREATE TRIGGER copywriting_research_entries_updated_at
    BEFORE UPDATE ON public.copywriting_research_entries
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 9. CHAT (revision conversation, Draft stage onward)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_messages (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID        NOT NULL REFERENCES public.copywriting_projects(id) ON DELETE CASCADE,
    role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copywriting_messages_project
    ON public.copywriting_messages(project_id, created_at);

-- ------------------------------------------------------------
-- 10. PROJECT EVENT LOG — step-by-step history shown on a finished project
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copywriting_project_events (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID        NOT NULL REFERENCES public.copywriting_projects(id) ON DELETE CASCADE,
    event_type TEXT        NOT NULL,
    summary    TEXT        NOT NULL DEFAULT '',
    payload    JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copywriting_project_events_project
    ON public.copywriting_project_events(project_id, created_at);

-- ------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.copywriting_publications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_publication_guides   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_article_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_trc_guides           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_prompt               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_prompt_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_project_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_project_images       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_research_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copywriting_project_events       ENABLE ROW LEVEL SECURITY;

-- Reference data (publications, article types, TRC guides, stage prompts):
-- any authenticated user may read (needed to run the workflow); only admins
-- write. API-route writes go through the service role.
DROP POLICY IF EXISTS "Authenticated users can read copywriting publications" ON public.copywriting_publications;
CREATE POLICY "Authenticated users can read copywriting publications"
    ON public.copywriting_publications FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins manage copywriting publications" ON public.copywriting_publications;
CREATE POLICY "Admins manage copywriting publications"
    ON public.copywriting_publications FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Authenticated users can read copywriting publication guides" ON public.copywriting_publication_guides;
CREATE POLICY "Authenticated users can read copywriting publication guides"
    ON public.copywriting_publication_guides FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins manage copywriting publication guides" ON public.copywriting_publication_guides;
CREATE POLICY "Admins manage copywriting publication guides"
    ON public.copywriting_publication_guides FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Authenticated users can read copywriting article types" ON public.copywriting_article_types;
CREATE POLICY "Authenticated users can read copywriting article types"
    ON public.copywriting_article_types FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins manage copywriting article types" ON public.copywriting_article_types;
CREATE POLICY "Admins manage copywriting article types"
    ON public.copywriting_article_types FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Authenticated users can read copywriting trc guides" ON public.copywriting_trc_guides;
CREATE POLICY "Authenticated users can read copywriting trc guides"
    ON public.copywriting_trc_guides FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins manage copywriting trc guides" ON public.copywriting_trc_guides;
CREATE POLICY "Admins manage copywriting trc guides"
    ON public.copywriting_trc_guides FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Authenticated users can read copywriting prompts" ON public.copywriting_prompt;
CREATE POLICY "Authenticated users can read copywriting prompts"
    ON public.copywriting_prompt FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins update copywriting prompts" ON public.copywriting_prompt;
CREATE POLICY "Admins update copywriting prompts"
    ON public.copywriting_prompt FOR UPDATE USING (public.user_role() = 'admin');
DROP POLICY IF EXISTS "Admins insert copywriting prompts" ON public.copywriting_prompt;
CREATE POLICY "Admins insert copywriting prompts"
    ON public.copywriting_prompt FOR INSERT WITH CHECK (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins manage copywriting prompt versions" ON public.copywriting_prompt_versions;
CREATE POLICY "Admins manage copywriting prompt versions"
    ON public.copywriting_prompt_versions FOR ALL USING (public.user_role() = 'admin');

-- Projects: a writer sees only their own. Admins see all (mirrors meeting-prep).
DROP POLICY IF EXISTS "Users read own copywriting projects" ON public.copywriting_projects;
CREATE POLICY "Users read own copywriting projects"
    ON public.copywriting_projects FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all copywriting projects" ON public.copywriting_projects;
CREATE POLICY "Admins read all copywriting projects"
    ON public.copywriting_projects FOR SELECT USING (public.user_role() = 'admin');
DROP POLICY IF EXISTS "Users insert own copywriting projects" ON public.copywriting_projects;
CREATE POLICY "Users insert own copywriting projects"
    ON public.copywriting_projects FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users update own copywriting projects" ON public.copywriting_projects;
CREATE POLICY "Users update own copywriting projects"
    ON public.copywriting_projects FOR UPDATE USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins update all copywriting projects" ON public.copywriting_projects;
CREATE POLICY "Admins update all copywriting projects"
    ON public.copywriting_projects FOR UPDATE USING (public.user_role() = 'admin');
-- Only admins may delete a project (US-style rule from the brief: delete is
-- admin-only on every project card).
DROP POLICY IF EXISTS "Admins delete copywriting projects" ON public.copywriting_projects;
CREATE POLICY "Admins delete copywriting projects"
    ON public.copywriting_projects FOR DELETE USING (public.user_role() = 'admin');

-- Child tables: reachable only through a project the caller owns (admins all).
DROP POLICY IF EXISTS "Users manage own copywriting project documents" ON public.copywriting_project_documents;
CREATE POLICY "Users manage own copywriting project documents"
    ON public.copywriting_project_documents FOR ALL USING (
        EXISTS (SELECT 1 FROM public.copywriting_projects p
                WHERE p.id = project_id
                  AND (p.user_id = auth.uid() OR public.user_role() = 'admin'))
    );

DROP POLICY IF EXISTS "Users manage own copywriting project images" ON public.copywriting_project_images;
CREATE POLICY "Users manage own copywriting project images"
    ON public.copywriting_project_images FOR ALL USING (
        EXISTS (SELECT 1 FROM public.copywriting_projects p
                WHERE p.id = project_id
                  AND (p.user_id = auth.uid() OR public.user_role() = 'admin'))
    );

DROP POLICY IF EXISTS "Users manage own copywriting research entries" ON public.copywriting_research_entries;
CREATE POLICY "Users manage own copywriting research entries"
    ON public.copywriting_research_entries FOR ALL USING (
        EXISTS (SELECT 1 FROM public.copywriting_projects p
                WHERE p.id = project_id
                  AND (p.user_id = auth.uid() OR public.user_role() = 'admin'))
    );

DROP POLICY IF EXISTS "Users manage own copywriting messages" ON public.copywriting_messages;
CREATE POLICY "Users manage own copywriting messages"
    ON public.copywriting_messages FOR ALL USING (
        EXISTS (SELECT 1 FROM public.copywriting_projects p
                WHERE p.id = project_id
                  AND (p.user_id = auth.uid() OR public.user_role() = 'admin'))
    );

DROP POLICY IF EXISTS "Users read own copywriting project events" ON public.copywriting_project_events;
CREATE POLICY "Users read own copywriting project events"
    ON public.copywriting_project_events FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.copywriting_projects p
                WHERE p.id = project_id
                  AND (p.user_id = auth.uid() OR public.user_role() = 'admin'))
    );
DROP POLICY IF EXISTS "Users insert own copywriting project events" ON public.copywriting_project_events;
CREATE POLICY "Users insert own copywriting project events"
    ON public.copywriting_project_events FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.copywriting_projects p
                WHERE p.id = project_id
                  AND (p.user_id = auth.uid() OR public.user_role() = 'admin'))
    );

-- ------------------------------------------------------------
-- 12. STORAGE BUCKETS (private)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('copywriting-publication-guides', 'copywriting-publication-guides', FALSE)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Admins manage copywriting publication guide files" ON storage.objects;
CREATE POLICY "Admins manage copywriting publication guide files"
    ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'copywriting-publication-guides' AND public.user_role() = 'admin')
    WITH CHECK (bucket_id = 'copywriting-publication-guides' AND public.user_role() = 'admin');

INSERT INTO storage.buckets (id, name, public)
VALUES ('copywriting-trc-guides', 'copywriting-trc-guides', FALSE)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Admins manage copywriting trc guide files" ON storage.objects;
CREATE POLICY "Admins manage copywriting trc guide files"
    ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'copywriting-trc-guides' AND public.user_role() = 'admin')
    WITH CHECK (bucket_id = 'copywriting-trc-guides' AND public.user_role() = 'admin');

-- Object paths are "<user_id>/<project_id>/<file>". Users manage only their
-- own folder. Admins may read/manage all.
INSERT INTO storage.buckets (id, name, public)
VALUES ('copywriting-project-documents', 'copywriting-project-documents', FALSE)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Users manage own copywriting project document files" ON storage.objects;
CREATE POLICY "Users manage own copywriting project document files"
    ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'copywriting-project-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'copywriting-project-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Admins manage all copywriting project document files" ON storage.objects;
CREATE POLICY "Admins manage all copywriting project document files"
    ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'copywriting-project-documents' AND public.user_role() = 'admin')
    WITH CHECK (bucket_id = 'copywriting-project-documents' AND public.user_role() = 'admin');

-- Photos for image slots: same "<owner uid>/<project id>/<file>" layout and
-- rules as project documents (the API stores under the project OWNER's folder
-- even when an admin uploads on their behalf).
INSERT INTO storage.buckets (id, name, public)
VALUES ('copywriting-images', 'copywriting-images', FALSE)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Users manage own copywriting image files" ON storage.objects;
CREATE POLICY "Users manage own copywriting image files"
    ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'copywriting-images' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'copywriting-images' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Admins manage all copywriting image files" ON storage.objects;
CREATE POLICY "Admins manage all copywriting image files"
    ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'copywriting-images' AND public.user_role() = 'admin')
    WITH CHECK (bucket_id = 'copywriting-images' AND public.user_role() = 'admin');

-- Tell PostgREST (Supabase's API layer) to pick up the new tables/columns
-- now rather than on its next schema-cache refresh.
NOTIFY pgrst, 'reload schema';
