-- ============================================================
-- 014 — Commercial Meeting Preparation module
-- ============================================================
-- Run this on an EXISTING production database created from an earlier 001.
-- Fresh databases already have everything (merged into 001_schema.sql).
-- Every statement is idempotent and SAFE TO RE-RUN — it uses
-- IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP POLICY IF EXISTS /
-- CREATE OR REPLACE throughout and never drops or alters existing data.
--
-- New module for TRC sales reps preparing for commercial meetings with company
-- CEOs and government officials (see TRC Commercial Meeting Preparation Tool
-- brief v1.1). Unlike the single-shot document engine (012), this is a
-- multi-stage, stateful workflow with two user approval gates:
--   input → research → internal validation (invisible) → user review (per
--   section, editable) → 3 presentation points (approval gate) → planteo
--   build-up (approval gate) → final assembled document (.docx export)
--
-- What it adds:
--   1. Per-user access flag (profiles + invitations) + handle_new_user copy
--   2. meeting_prep_media_library            — one row per TRC publication
--   3. meeting_prep_planteo_library (+ versions) — 2 fixed variants (CEO / Govt)
--   4. meeting_prep_prompt (+ versions)      — 4 singleton prompts, one per stage
--   5. meeting_prep_sessions                 — one row per meeting prep run
--
-- Depends on objects already created by 001: public.update_updated_at(),
-- public.user_role(), public.profiles, and the uuid_generate_v4() extension.
-- Note: usage_events.workflow is a plain TEXT column with no CHECK constraint,
-- so the new workflow values ('meeting_prep_research' etc.) need no DDL.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PER-USER MODULE ACCESS
-- ------------------------------------------------------------
-- Adding a column with a constant default is a metadata-only change in
-- Postgres 11+ (no table rewrite) — safe on a live table. Defaults FALSE so
-- NO existing user gains access; behaviour is unchanged until an admin
-- explicitly grants it (matches the business-cases/editorial-briefs rollout).
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_access_meeting_preparation BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS can_access_meeting_preparation BOOLEAN NOT NULL DEFAULT FALSE;

-- Re-declare handle_new_user to also copy the new invite flag onto the new
-- profile. Admins always get full access. CREATE OR REPLACE is safe to re-run.
-- IMPORTANT: this must preserve every existing column it already sets.
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
        can_access_meeting_preparation
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
             ELSE COALESCE(v_invite.can_access_meeting_preparation, FALSE) END
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
-- 2. MEDIA LIBRARY (one row per TRC publication)
-- ------------------------------------------------------------
-- Plain reference data, not a prompt — no versioning. The workflow looks this
-- up by publication_name at Step 1; if no row exists the tool halts (US-022).
CREATE TABLE IF NOT EXISTS public.meeting_prep_media_library (
    id                         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    publication_name           TEXT        NOT NULL UNIQUE,
    positioning_statement      TEXT        NOT NULL DEFAULT '',
    audience_reach             TEXT        NOT NULL DEFAULT '',
    editorial_narrative_focus  TEXT        NOT NULL DEFAULT '',
    country_of_publication     TEXT        NOT NULL,
    created_by                 UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS meeting_prep_media_library_updated_at ON public.meeting_prep_media_library;
CREATE TRIGGER meeting_prep_media_library_updated_at
    BEFORE UPDATE ON public.meeting_prep_media_library
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 3. PLANTEO LIBRARY (exactly 2 fixed variants) + version history
-- ------------------------------------------------------------
-- Appendix A of the brief ("TRC Planteo Build-Up") is the source of truth for
-- both variants' approved script/formula. It is pending delivery from the TRC
-- commercial team, so both rows seed with empty template_text — admin-editable
-- once supplied. The brief requires that any update to this document be
-- logged, hence the version history (mirrors category_prompt_versions).
CREATE TABLE IF NOT EXISTS public.meeting_prep_planteo_library (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant       TEXT        NOT NULL UNIQUE
        CHECK (variant IN ('company_ceo', 'government_official')),
    template_text TEXT        NOT NULL DEFAULT '',
    updated_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.meeting_prep_planteo_library (variant)
SELECT 'company_ceo'
WHERE NOT EXISTS (SELECT 1 FROM public.meeting_prep_planteo_library WHERE variant = 'company_ceo');

INSERT INTO public.meeting_prep_planteo_library (variant)
SELECT 'government_official'
WHERE NOT EXISTS (SELECT 1 FROM public.meeting_prep_planteo_library WHERE variant = 'government_official');

DROP TRIGGER IF EXISTS meeting_prep_planteo_library_updated_at ON public.meeting_prep_planteo_library;
CREATE TRIGGER meeting_prep_planteo_library_updated_at
    BEFORE UPDATE ON public.meeting_prep_planteo_library
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.meeting_prep_planteo_library_versions (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant       TEXT        NOT NULL
        CHECK (variant IN ('company_ceo', 'government_official')),
    template_text TEXT        NOT NULL,
    saved_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_prep_planteo_versions_variant_created
    ON public.meeting_prep_planteo_library_versions(variant, created_at DESC);

-- ------------------------------------------------------------
-- 4. STAGE PROMPTS (one singleton row per stage) + version history
-- ------------------------------------------------------------
-- Mirrors document_prompt/document_prompt_versions (012), keyed by
-- prompt_key instead of doc_type. Seeded with default prompt text authored
-- directly from the brief so the module works immediately; admins can edit
-- and roll back via the shared PromptVersionHistory component.
CREATE TABLE IF NOT EXISTS public.meeting_prep_prompt (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_key  TEXT        NOT NULL UNIQUE
        CHECK (prompt_key IN ('research', 'presentation_points', 'planteo', 'final_document')),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.meeting_prep_prompt (prompt_key, prompt_text)
SELECT 'research', $seed$You are a senior research analyst at The Report Company preparing a TRC sales representative for a commercial meeting with a company CEO or government official.

Research the interviewee and their organisation using approved sources, oriented toward BOTH editorial compellingness AND commercial readiness to invest in TRC's platform.

Source priority (highest first): company investor relations pages/official filings; major financial press (Financial Times, Bloomberg, Reuters, Wall Street Journal); sector regulators/official statistics bodies; World Bank/IMF/OECD/official trade and investment agencies; reputable sector-specific publications; company-owned marketing materials (context only — flag as unverified if used as evidence).

Recency: financial/market data no older than 24 months; biographical/career information may extend to 5 years; quotes and news no older than 12 months wherever possible. Older data may be included only if it provides essential context, and must be labelled with its date.

Editorial orientation: business-oriented and commercially purposeful throughout. Never surface negative, corrosive or reputationally damaging content. A mildly challenging business fact may be included only if framed constructively and it does not undermine the commercial objective of the meeting.

Every factual claim must carry a visible source. Flag unsourced or low-confidence claims explicitly — never omit them silently.

Produce exactly four sections, each introduced by its own marker line on its own line (no other text on that line), in this exact order:

<<<SECTION:INTERVIEWEE>>>
Professional background and career trajectory; role in growth of the current organisation and (if applicable) previous organisations; stated vision and values; public positions on investment, growth and international markets; awards/recognitions/notable public profile.

<<<SECTION:ORGANISATION>>>
Company size and turnover; growth over time (revenues, headcount, market footprint); market positioning and perception; rank/market share within sector; top-50/top-100 standing and notable awards; competitive edge over main competitors; growth strategy; investment strategy and potential need for external financing or partners; international operations/export activity/expansion plans; ties to the country of publication; anything relevant to TRC's editorial narratives on business and investment.

<<<SECTION:MOTIVATION_PROFILES>>>
Rank ALL relevant commercial motivation profiles from most to least applicable, each with exactly one sentence of evidence from the research. Assess against these six standard profiles: international market access; investment attraction; sector leadership & competitive positioning; nation brand & FDI attraction (Government Officials only); legacy & personal reputation (handle with intelligence — interwoven with business/editorial narrative, never overt); sector/country advocacy. Exclude any profile with no supporting evidence — do not list it as "not applicable."

<<<SECTION:QUOTES_NEWS>>>
2-3 strong, recent, sourced and dated quotes from the interviewee that reveal their ambitions, sector view or international outlook, prioritising quotes usable naturally in conversation. Then 2-3 recent, sourced and dated news items directly relevant to this person or organisation, prioritising a natural "why now" angle for the meeting.

End your response immediately after the QUOTES_NEWS section with no further commentary.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.meeting_prep_prompt WHERE prompt_key = 'research');

INSERT INTO public.meeting_prep_prompt (prompt_key, prompt_text)
SELECT 'presentation_points', $seed$You are drafting 3 presentation points for a TRC sales representative, explaining why TRC wants to feature this CEO or government official, why now, and how they fit the publication's editorial narrative.

Draw EXCLUSIVELY from the approved research and ranked motivation profiles provided — introduce no new facts.

Each of the 3 points must be:
- Genuinely distinct from the other two
- Grounded in the approved research
- Directly relevant to the publication's editorial narrative
- Implicitly tied to one or more of the ranked motivation profiles — the motivation must never be labelled or stated overtly; the sales rep should be activating a motivation without the interviewee feeling sold to
- Phrased in natural, verbal language — something a sales rep can say aloud, not read
- Concise: one to three sentences maximum

Avoid sales/marketing language, generic praise, overloaded statistics, formal/academic phrasing, and any claim not grounded in the approved research.

Return exactly 3 points, each on its own line prefixed with "1. ", "2. ", "3. " — nothing else.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.meeting_prep_prompt WHERE prompt_key = 'presentation_points');

INSERT INTO public.meeting_prep_prompt (prompt_key, prompt_text)
SELECT 'planteo', $seed$You are building the planteo (verbal pitch build-up) for a TRC sales representative's meeting, using the approved TRC planteo formula provided for this interviewee's variant (Company CEO or Government Official). You may NOT deviate from or improvise structure outside that approved formula.

Weave the 3 approved presentation points into the planteo structure. Activate the ranked motivation profiles implicitly — the commercial argument must land through the editorial story, never as a direct or overt pitch.

Format as a hybrid: one short opening paragraph of spoken script to set the frame, followed by structured bullet-point cues the sales rep expands verbally. Use facts and data selectively — enough to be credible, not so many it feels like a presentation.

Do not introduce any fact, claim or figure that was not present in the approved research and points. Tone: authoritative but conversational, natural to speak aloud, business-positive. Avoid sales language, generic praise, formal phrasing, and any negative or reputationally sensitive framing.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.meeting_prep_prompt WHERE prompt_key = 'planteo');

INSERT INTO public.meeting_prep_prompt (prompt_key, prompt_text)
SELECT 'final_document', $seed$Assemble the final Commercial Meeting Preparation document for a TRC sales representative from the approved material provided (advertiser history, research sections, ranked motivation profiles, quotes & news, the 3 approved presentation points, and the approved planteo). Do not introduce any fact not present in that approved material.

Produce a single document, default 3 pages, maximum 4 pages only if the research quality genuinely justifies it — do not pad length; if the research is thin, 2 pages is acceptable.

Structure, in this exact order:
1. Commercial Alert — always first, always visible. If the company previously advertised with TRC: publication, space purchased, approximate period. If not: a brief note confirming no previous advertising history on record, with a prompt to verify manually.
2. Interviewee & Company Snapshot — 5-6 tight bullet points on what matters most for this meeting, not a biography.
3. Motivation Profile Ranking — all relevant profiles ranked most to least applicable, each with one sentence of evidence. Do not repeat these motivations verbatim inside the planteo section.
4. What They've Said Recently — the 2-3 quotes and 2-3 news items, sourced and dated.
5. 3 Presentation Points — written to be spoken, no motivation labels shown.
6. Planteo Build-Up — the opening paragraph plus structured bullet-point cues, verbatim from the approved planteo.

Before finishing, verify silently: every factual claim has a visible source; the Commercial Alert is present and complete; motivation profiles are ranked and evidenced; no motivation is stated overtly; the 3 points are genuinely distinct; all quotes are sourced and dated; no negative or reputationally damaging content is present; tone is conversational and verbal throughout; the document does not exceed 4 pages. Correct anything that fails before ending your response.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.meeting_prep_prompt WHERE prompt_key = 'final_document');

CREATE TABLE IF NOT EXISTS public.meeting_prep_prompt_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_key  TEXT        NOT NULL
        CHECK (prompt_key IN ('research', 'presentation_points', 'planteo', 'final_document')),
    prompt_text TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_prep_prompt_versions_key_created
    ON public.meeting_prep_prompt_versions(prompt_key, created_at DESC);

-- ------------------------------------------------------------
-- 5. MEETING PREP SESSIONS (one row per run; the workflow state machine)
-- ------------------------------------------------------------
-- user_id is nullable and SET NULL on profile delete so history survives when
-- an author is permanently deleted (US-011 pattern, mirrors research_sessions).
CREATE TABLE IF NOT EXISTS public.meeting_prep_sessions (
    id                            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,

    -- Step 1 — user input
    interviewee_name              TEXT        NOT NULL,
    interviewee_title             TEXT        NOT NULL,
    interviewee_type              TEXT        NOT NULL
        CHECK (interviewee_type IN ('company_ceo', 'government_official')),
    company_org                   TEXT        NOT NULL,
    company_country               TEXT        NOT NULL,
    publication                   TEXT        NOT NULL,
    publication_country           TEXT        NOT NULL,

    -- Media profile, snapshotted at creation so a later library edit never
    -- retroactively changes an in-flight or completed session.
    media_library_id              UUID        REFERENCES public.meeting_prep_media_library(id) ON DELETE SET NULL,
    media_positioning_snapshot    TEXT,
    media_audience_reach_snapshot TEXT,
    media_narrative_snapshot      TEXT,

    -- Step 2 (advertiser history check — Phase 1 manual entry)
    advertiser_history_status     TEXT
        CHECK (advertiser_history_status IN ('yes', 'no')),
    advertiser_history_details    TEXT,

    -- Step 2/3/4 — research sections (interviewee, organisation,
    -- motivation_profiles, quotes_news), each a markdown string.
    research_sections             JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- Step 5 — up to 3 presentation point strings.
    presentation_points           JSONB       NOT NULL DEFAULT '[]'::jsonb,

    -- Step 6 / Step 7
    planteo_output                TEXT,
    final_output                  TEXT,

    -- Prompt snapshots (what was actually used for this run).
    research_prompt_snapshot      TEXT,
    points_prompt_snapshot        TEXT,
    planteo_prompt_snapshot       TEXT,
    final_doc_prompt_snapshot     TEXT,
    planteo_library_snapshot      TEXT,

    stage                         TEXT        NOT NULL DEFAULT 'input'
        CHECK (stage IN (
            'input', 'researching', 'awaiting_review',
            'points_generating', 'points_pending',
            'planteo_generating', 'planteo_pending',
            'final_generating', 'complete', 'failed'
        )),
    error                         TEXT,

    -- Usage accumulates across all 4 AI calls for this session (like
    -- research_questions accumulates onto research_sessions).
    tokens_input                  INTEGER     DEFAULT 0,
    tokens_output                 INTEGER     DEFAULT 0,
    tokens_total                  INTEGER     DEFAULT 0,
    web_searches                  INTEGER     DEFAULT 0,
    cost_usd                      NUMERIC(10, 6) DEFAULT 0,

    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_prep_sessions_user_id
    ON public.meeting_prep_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_prep_sessions_created
    ON public.meeting_prep_sessions(created_at DESC);

DROP TRIGGER IF EXISTS meeting_prep_sessions_updated_at ON public.meeting_prep_sessions;
CREATE TRIGGER meeting_prep_sessions_updated_at
    BEFORE UPDATE ON public.meeting_prep_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.meeting_prep_media_library          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_planteo_library         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_planteo_library_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_prompt                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_prompt_versions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_prep_sessions                ENABLE ROW LEVEL SECURITY;

-- Media library: any authenticated user may read (needed at Step 1 lookup);
-- only admins write. Writes from API routes go through the service role.
DROP POLICY IF EXISTS "Authenticated users can read media library" ON public.meeting_prep_media_library;
CREATE POLICY "Authenticated users can read media library"
    ON public.meeting_prep_media_library FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can manage media library" ON public.meeting_prep_media_library;
CREATE POLICY "Admins can manage media library"
    ON public.meeting_prep_media_library FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Authenticated users can read planteo library" ON public.meeting_prep_planteo_library;
CREATE POLICY "Authenticated users can read planteo library"
    ON public.meeting_prep_planteo_library FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update planteo library" ON public.meeting_prep_planteo_library;
CREATE POLICY "Admins can update planteo library"
    ON public.meeting_prep_planteo_library FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage planteo library versions" ON public.meeting_prep_planteo_library_versions;
CREATE POLICY "Admins can manage planteo library versions"
    ON public.meeting_prep_planteo_library_versions FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Authenticated users can read meeting prep prompt" ON public.meeting_prep_prompt;
CREATE POLICY "Authenticated users can read meeting prep prompt"
    ON public.meeting_prep_prompt FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update meeting prep prompt" ON public.meeting_prep_prompt;
CREATE POLICY "Admins can update meeting prep prompt"
    ON public.meeting_prep_prompt FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage meeting prep prompt versions" ON public.meeting_prep_prompt_versions;
CREATE POLICY "Admins can manage meeting prep prompt versions"
    ON public.meeting_prep_prompt_versions FOR ALL USING (public.user_role() = 'admin');

-- Sessions: users see/manage their own, admins see all (mirrors document_sessions).
DROP POLICY IF EXISTS "Users can read own meeting prep sessions" ON public.meeting_prep_sessions;
CREATE POLICY "Users can read own meeting prep sessions"
    ON public.meeting_prep_sessions FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins can read all meeting prep sessions" ON public.meeting_prep_sessions;
CREATE POLICY "Admins can read all meeting prep sessions"
    ON public.meeting_prep_sessions FOR SELECT USING (public.user_role() = 'admin');
DROP POLICY IF EXISTS "Users can insert own meeting prep sessions" ON public.meeting_prep_sessions;
CREATE POLICY "Users can insert own meeting prep sessions"
    ON public.meeting_prep_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can update own meeting prep sessions" ON public.meeting_prep_sessions;
CREATE POLICY "Users can update own meeting prep sessions"
    ON public.meeting_prep_sessions FOR UPDATE USING (user_id = auth.uid());
