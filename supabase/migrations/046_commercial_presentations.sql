-- ============================================================
-- 046 — Commercial Presentation Generator
-- ============================================================
-- Run on any database that already ran 001–044 (needs media_library from 039,
-- document_sessions and interview_letter_projects). Idempotent and SAFE TO
-- RE-RUN: IF NOT EXISTS / WHERE NOT EXISTS / DROP ... IF EXISTS / CREATE OR
-- REPLACE throughout. Never alters or deletes existing data in other modules.
--
-- Client brief: docs "AI Brief R TRC COMMERCIAL PRESENTATION GENERATOR"
-- (26 Sep 2026). One standardised, spoken commercial presentation per
-- PROJECT, assembled from admin-controlled master content plus one
-- AI-written block ("Why [Country] Now"), approved and locked by a
-- Manager/Admin before use.
--
-- What it adds:
--   1. Two per-user flags on profiles/invitations:
--        can_access_commercial_presentations  — use the module
--        can_approve_commercial_presentations — Manager/Admin approval
--      and re-declares handle_new_user (034 version + these two flags).
--   2. agencies — admin-managed list (TRC, Global FDI Reports, …).
--      letter_company maps an agency to the Interview Letters company code,
--      so the module can generate a letter for it.
--   3. projects — the shared "Project" entity (agency + country + media +
--      edition). Holds the Editorial Brief and Interview Letter currently
--      "in use" for the project. Module-agnostic so other tools can link to
--      it later; only this module writes it today.
--   4. presentation_master_content (+ _versions) — every piece of master
--      content, versioned with major.minor labels:
--        kind 'structure'      — the six blocks, their SAY/ACTION templates
--                                and the manual field definitions (global)
--        kind 'agency'         — optional Block 2 override per agency
--        kind 'media'          — Block 3 script + Media Market per publication
--        kind 'why_now_prompt' — the Why [Country] Now prompt + its rules
--   5. presentation_reference_examples — 10–20 admin-selected examples used
--      for style only, never as factual sources.
--   6. commercial_presentations, presentation_why_now_versions,
--      presentation_snapshots (approved, immutable), presentation_events.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PER-USER FLAGS
-- ------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_access_commercial_presentations  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS can_approve_commercial_presentations BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS can_access_commercial_presentations  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS can_approve_commercial_presentations BOOLEAN NOT NULL DEFAULT FALSE;

-- Re-declared from 034 (the latest version) with the two new flags added.
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
        can_access_copywriting_tool,
        can_access_knowledge_base,
        can_access_commercial_presentations,
        can_approve_commercial_presentations
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
             ELSE COALESCE(v_invite.can_access_copywriting_tool, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_knowledge_base, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_access_commercial_presentations, FALSE) END,
        CASE WHEN v_role = 'admin' THEN TRUE
             ELSE COALESCE(v_invite.can_approve_commercial_presentations, FALSE) END
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

-- Read access for RLS: active admins, or active users with the module flag.
CREATE OR REPLACE FUNCTION public.can_access_commercial_presentations()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.status = 'active'
          AND (p.role = 'admin' OR p.can_access_commercial_presentations)
    );
$$;

-- ------------------------------------------------------------
-- 2. AGENCIES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agencies (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name           TEXT        NOT NULL,
    -- Interview Letters only knows 'TRC' and 'GFDI'. An agency without a
    -- mapping can still be presented; its letter just can't be generated
    -- automatically (attach one instead).
    letter_company TEXT        CHECK (letter_company IN ('TRC', 'GFDI')),
    active         BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order     INTEGER     NOT NULL DEFAULT 0,
    created_by     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agencies_name ON public.agencies (lower(btrim(name)));

DROP TRIGGER IF EXISTS agencies_updated_at ON public.agencies;
CREATE TRIGGER agencies_updated_at BEFORE UPDATE ON public.agencies
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.agencies (name, letter_company, sort_order)
SELECT v.name, v.code, v.ord FROM (VALUES
    ('The Report Company', 'TRC', 1),
    ('Global FDI Reports', 'GFDI', 2)
) AS v(name, code, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.agencies a WHERE lower(btrim(a.name)) = lower(v.name));

-- ------------------------------------------------------------
-- 3. PROJECTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
    id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                   TEXT        NOT NULL,
    agency_id              UUID        REFERENCES public.agencies(id) ON DELETE SET NULL,
    agency_name            TEXT        NOT NULL DEFAULT '',
    country                TEXT        NOT NULL,
    media_id               UUID        REFERENCES public.media_library(id) ON DELETE SET NULL,
    media_name             TEXT        NOT NULL DEFAULT '',
    -- Edition distinguishes the same agency + country + media done again
    -- later (e.g. "2026", "November 2026").
    edition                TEXT        NOT NULL DEFAULT '',
    anchor_event           TEXT        NOT NULL DEFAULT '',
    anchor_date            TEXT        NOT NULL DEFAULT '',
    -- Optional approved project research pasted by the team (source 4 in the
    -- brief's hierarchy).
    approved_research      TEXT        NOT NULL DEFAULT '',
    editorial_brief_id     UUID        REFERENCES public.document_sessions(id) ON DELETE SET NULL,
    editorial_brief_source TEXT        CHECK (editorial_brief_source IN ('attached', 'generated')),
    interview_letter_id    UUID        REFERENCES public.interview_letter_projects(id) ON DELETE SET NULL,
    interview_letter_source TEXT       CHECK (interview_letter_source IN ('attached', 'generated')),
    status                 TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_by             UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by             UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_country ON public.projects (lower(country));
CREATE INDEX IF NOT EXISTS idx_projects_created ON public.projects (created_at DESC);

DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 4. MASTER CONTENT (+ versions)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.presentation_master_content (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind          TEXT        NOT NULL CHECK (kind IN ('structure', 'agency', 'media', 'why_now_prompt')),
    -- agency_id for kind 'agency', media_library.id for kind 'media', NULL otherwise.
    ref_id        UUID,
    language      TEXT        NOT NULL DEFAULT 'en',
    content       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    version_label TEXT        NOT NULL DEFAULT '0.0' CHECK (version_label ~ '^[0-9]+\.[0-9]+$'),
    updated_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_master_content_key
    ON public.presentation_master_content (kind, COALESCE(ref_id, '00000000-0000-0000-0000-000000000000'::uuid), language);

CREATE TABLE IF NOT EXISTS public.presentation_master_versions (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_id    UUID        NOT NULL REFERENCES public.presentation_master_content(id) ON DELETE CASCADE,
    content       JSONB       NOT NULL,
    version_label TEXT        NOT NULL CHECK (version_label ~ '^[0-9]+\.[0-9]+$'),
    saved_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_presentation_master_versions_content
    ON public.presentation_master_versions (content_id, created_at DESC);

-- Seed: the standard six-block structure, word for word from the brief's
-- example template (section 24). Admin-editable from day one.
INSERT INTO public.presentation_master_content (kind, ref_id, language, content)
SELECT 'structure', NULL, 'en', $json${
  "blocks": [
    {
      "key": "chit_chat",
      "title": "Chit Chat and Seating",
      "type": "template",
      "typeLabel": "Locked methodology",
      "segments": [
        {"id": "cc1", "kind": "action", "text": "Make sure to establish rapport. It will help you close the sale."},
        {"id": "cc2", "kind": "action", "text": "Have a couple of topics for conversation ready. Ideally, these should be about their office, the city, artwork in the office or something else you notice around you."},
        {"id": "cc3", "kind": "action", "text": "Avoid chit chat about the company itself, so the interviewee does not start the interview before you are ready."},
        {"id": "cc4", "kind": "action", "heading": "Seating", "text": "Sit next to the interviewee whenever possible."},
        {"id": "cc5", "kind": "action", "text": "The interviewer should sit to your side so that you remain in the interviewee's line of sight during the interview."},
        {"id": "cc6", "kind": "action", "text": "Whenever possible, avoid sitting directly opposite the CEO with a table separating you. This makes it more difficult to show materials and, later, to present the commercial opportunity and sign contracts."},
        {"id": "cc7", "kind": "say", "heading": "Say if required", "text": "Sir, would you mind sitting here? That way I can show you some materials that I think will be of interest to you."}
      ]
    },
    {
      "key": "presenting_ourselves",
      "title": "Presenting Ourselves",
      "type": "agency",
      "typeLabel": "Master content + variables + manual input",
      "segments": [
        {"id": "po1", "kind": "say", "text": "Mr. [NAME], we were very keen to meet with you today for a number of editorial reasons that I'll come to in a moment."},
        {"id": "po2", "kind": "say", "text": "But first, allow me to take a couple of minutes to give you some context about this interview and how your comments today will be presented in [MEDIA]."},
        {"id": "po3", "kind": "say", "showIf": "ANCHOR EVENT", "text": "We at [AGENCY] are working on a special business report on [COUNTRY] that we aim to publish in [MEDIA] around [ANCHOR EVENT]."},
        {"id": "po4", "kind": "say", "hideIf": "ANCHOR EVENT", "text": "We at [AGENCY] are working on a special business report on [COUNTRY] that we aim to publish in [MEDIA]."},
        {"id": "po5", "kind": "say", "text": "We partner with [MEDIA] for the exclusive production of this special report on your country."},
        {"id": "po6", "kind": "say", "text": "As part of the project, we are meeting with some of the most important decision makers in the country, from both the public and private sectors."},
        {"id": "po7", "kind": "action", "text": "Show photographs of representative people already interviewed."},
        {"id": "po8", "kind": "action", "text": "If the team has only recently arrived in the country, mention important people scheduled to be interviewed over the following days."},
        {"id": "po9", "kind": "action", "heading": "People to mention / show", "showIf": "PEOPLE TO MENTION", "text": "[PEOPLE TO MENTION]"},
        {"id": "po10", "kind": "note", "text": "Objective: build clout and credibility as early as possible in the meeting."}
      ]
    },
    {
      "key": "media_product",
      "title": "The Media and the Product",
      "type": "media",
      "typeLabel": "Media master content",
      "segments": []
    },
    {
      "key": "why_now",
      "title": "Why [COUNTRY] Now",
      "type": "why_now",
      "typeLabel": "AI-generated project content",
      "segments": [
        {"id": "wn1", "kind": "say", "text": "[WHY NOW]"}
      ]
    },
    {
      "key": "mockup",
      "title": "Presenting the Mockup",
      "type": "template",
      "typeLabel": "Master content + manual variables",
      "segments": [
        {"id": "mk1", "kind": "say", "text": "This is a mockup of the publication, which will give you an idea of how the report comes together."},
        {"id": "mk2", "kind": "action", "text": "Open the mockup and move through the relevant pages while speaking."},
        {"id": "mk3", "kind": "say", "text": "The introduction is followed by our main coverage of [MAIN INTERVIEW]."},
        {"id": "mk4", "kind": "say", "text": "We then have a section looking at [INVESTMENT ANGLE], followed by coverage of some of the most strategic sectors of the economy."},
        {"id": "mk5", "kind": "say", "text": "Each sector is introduced by the relevant minister and features some of the leading companies and CEOs."},
        {"id": "mk6", "kind": "say", "text": "For example, we will cover [MAIN SECTORS]."},
        {"id": "mk7", "kind": "action", "text": "Point to the relevant sections as they are mentioned."},
        {"id": "mk8", "kind": "say", "heading": "Commercial transition (protected master language)", "text": "As you can see, there is also a commercial dimension for companies that want to benefit from positive exposure in [MEDIA MARKET]."},
        {"id": "mk9", "kind": "action", "text": "Point specifically to a Corporate Profile with a company logo while saying this."},
        {"id": "mk10", "kind": "say", "showIf": "OTHER SECTION", "text": "And finally, we normally include a section looking at [OTHER SECTION]."},
        {"id": "mk11", "kind": "say", "hideIf": "OTHER SECTION", "text": "And finally, we normally include a section looking at the country's tourism attractiveness."}
      ]
    },
    {
      "key": "transition",
      "title": "Transition to Interview",
      "type": "template",
      "typeLabel": "Locked methodology",
      "segments": [
        {"id": "tr1", "kind": "say", "text": "Without further ado, I suggest we begin with the interview."}
      ]
    }
  ],
  "manualFields": [
    {"key": "PEOPLE TO MENTION", "label": "People to mention / show", "placeholder": "e.g. ministers, CEOs, previous interviews", "required": false, "multiline": true},
    {"key": "MAIN INTERVIEW", "label": "Mockup – main interview", "placeholder": "e.g. the President, the Minister of Economy", "required": true, "multiline": false},
    {"key": "INVESTMENT ANGLE", "label": "Mockup – investment angle", "placeholder": "e.g. the country's investment attractiveness, FDI and infrastructure", "required": true, "multiline": false},
    {"key": "MAIN SECTORS", "label": "Mockup – main sectors", "placeholder": "e.g. infrastructure, telecom, energy and financial services", "required": true, "multiline": false},
    {"key": "OTHER SECTION", "label": "Other relevant section (optional)", "placeholder": "e.g. the country's tourism attractiveness", "required": false, "multiline": false}
  ]
}$json$::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM public.presentation_master_content WHERE kind = 'structure' AND ref_id IS NULL AND language = 'en'
);

-- Seed: the Why [Country] Now prompt (brief section 14: ROLE → FACTUAL
-- DISCIPLINE). INPUTS and OUTPUT are added by the code, not the admin text.
INSERT INTO public.presentation_master_content (kind, ref_id, language, content)
SELECT 'why_now_prompt', NULL, 'en', jsonb_build_object(
    'prompt', $prompt$ROLE
You are helping prepare the opening commercial presentation used by [AGENCY] before an interview with a senior CEO, minister or decision maker.

Your task is to write the "Why [COUNTRY] Now" section of that presentation.

This will be spoken aloud in a face-to-face meeting. It is not an article, research report, email or written editorial brief.

OBJECTIVE
In approximately 45–60 seconds, explain why this is a particularly relevant moment to publish a business report on [COUNTRY] for the audience of [MEDIA] in [MEDIA MARKET].

Select only the strongest editorial arguments.

The listener should quickly understand:
1. Why the country matters now.
2. Why it matters specifically to this Media's audience.
3. Why the timing of the publication makes editorial sense.

Do not try to include everything you know.

HOW TO DETERMINE THE ANGLE
If the user has supplied an anchor event or editorial context, treat it as an important input and build the argument around it where editorially appropriate.

Do not blindly use the supplied anchor if another argument is materially stronger. The objective is always to produce the strongest credible editorial rationale.

If no anchor event has been supplied, determine the strongest Why Now yourself from the available project information.

Look for a small number of genuinely strong developments such as major bilateral developments, trade or investment agreements, important diplomatic or economic moments, major reforms, significant investments, geopolitical developments, strategic industries or international events.

Do not invent an event simply to create a hook.

If there is no single dominant event, construct the argument around the strongest combination of current developments.

Use the Editorial Brief and Interview Request Letter as the primary factual and editorial sources.

Approved Reference Examples may only be used to understand TRC's preferred style, structure, level of detail and editorial reasoning.

Never transfer facts, people, companies, events, investments or country-specific arguments from a Reference Example into the current presentation.

Use fresh external research only when existing project information is insufficient, when specifically requested, or when recent developments materially strengthen or update the argument.

WRITING RULES
Write exactly as a strong TRC commercial executive would speak.
Be conversational, confident and engaging.
Use simple sentences.
Make a few strong points rather than many weak ones.
Normally use 2–4 substantive editorial points.
Explain why developments matter rather than simply listing them.
Prioritise concrete developments over generic statements such as "the economy is growing" or "the country offers many opportunities."
Use statistics selectively. Include a number only when it materially strengthens the argument and is easy for the listener to remember.
Avoid unnecessary statistics, jargon, academic language, long sentences and exaggerated promotional language.
Avoid clichés and generic AI language such as "at the crossroads", "dynamic economy", "exciting opportunities" or "rapidly evolving landscape", or similar expressions unless genuinely justified and natural in context.
Do not write headings, bullet points or explanatory notes inside the spoken version.
Do not mention sources or the research process in the spoken text.
Do not simply summarise the Editorial Brief. Select and communicate the few points that make the strongest verbal argument.
The final result should sound natural when spoken from memory.

FUTURE PUBLICATION DATES AND EVENTS
Never imply an unconditional publication commitment around a future event or date unless explicitly confirmed.
Use language such as "We aim to publish around…", "We intend to coincide with…", "Publication is scheduled for…" or "The report is planned around…".
Do not automatically say "The report will be published…" when referring to a planned future publication date or event.

FACTUAL DISCIPLINE
Never invent facts, dates, investments, agreements, attendees, political participation, commercial relationships, meetings or publication commitments.
Give priority to information contained in the Editorial Brief, Interview Request Letter and approved project research.
If fresh external research is used, only use reliable sources.
Any material new external fact not already contained in approved project sources must be identified separately for human review.
If available information does not support a claim, do not make it.$prompt$,
    'minWords', 100,
    'maxWords', 170,
    'wordsPerMinute', 150,
    'bannedPhrases', jsonb_build_array('at the crossroads', 'dynamic economy', 'exciting opportunities', 'rapidly evolving landscape', 'land of opportunity', 'in today''s fast-paced world'),
    'maxWebSearches', 5,
    'referenceExamplesLimit', 4,
    'briefChars', 40000,
    'letterChars', 12000
)
WHERE NOT EXISTS (
    SELECT 1 FROM public.presentation_master_content WHERE kind = 'why_now_prompt' AND ref_id IS NULL AND language = 'en'
);

-- Seed: the brief's own USA Today example script (section 24, Block 3) for
-- the USA Today Media Library entry, if there is one. Admins replace it.
INSERT INTO public.presentation_master_content (kind, ref_id, language, content)
SELECT 'media', m.id, 'en', $json${
  "mediaMarket": "the US",
  "segments": [
    {"id": "md1", "kind": "say", "text": "You may already be familiar with USA Today, but allow me to share a few key details."},
    {"id": "md2", "kind": "say", "text": "USA Today is one of the world's most iconic media brands. It is available across all 50 states and reaches 133 million Americans through its print and online editions."},
    {"id": "md3", "kind": "say", "text": "Its readers include decision makers from both the political and business communities, and the newspaper is subscribed to by many offices across the country."},
    {"id": "md4", "kind": "say", "text": "You could say this is the newspaper that many Americans have breakfast with and use to get an idea of what is happening in the world that day."},
    {"id": "md5", "kind": "say", "text": "So you can rest assured that your comments today will reach a highly influential audience."},
    {"id": "md6", "kind": "action", "text": "Show the physical publication where appropriate."},
    {"id": "md7", "kind": "say", "heading": "Distribution", "text": "The [COUNTRY] business special will be distributed across several print and digital channels. It will appear as a dedicated section of the newspaper, like this."},
    {"id": "md8", "kind": "action", "text": "Take an existing country report and clearly show how it is distributed inside the newspaper."},
    {"id": "md9", "kind": "say", "text": "But it will also have a strong digital presence. There will be a digital version of the report on the website…"},
    {"id": "md10", "kind": "action", "text": "Show the relevant website and the USA Today branding."},
    {"id": "md11", "kind": "say", "text": "…and a selected number of podcasts will be created for our Spotify and Apple podcast channels. All the content, including the full Q&As from our interviews, will also appear on our website."},
    {"id": "md12", "kind": "say", "text": "So we will reach readers wherever they are and however they prefer to consume the content."}
  ]
}$json$::jsonb
FROM public.media_library m
WHERE lower(btrim(m.name)) = 'usa today'
  AND NOT EXISTS (
    SELECT 1 FROM public.presentation_master_content c
    WHERE c.kind = 'media' AND c.ref_id = m.id AND c.language = 'en'
  );

-- ------------------------------------------------------------
-- 5. REFERENCE EXAMPLES (style only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.presentation_reference_examples (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    title        TEXT        NOT NULL,
    -- One of the brief's project types (major international event, bilateral
    -- relations, …) — used to pick a varied set, never as a filter on facts.
    project_type TEXT        NOT NULL DEFAULT '',
    body         TEXT        NOT NULL,
    active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS presentation_reference_examples_updated_at ON public.presentation_reference_examples;
CREATE TRIGGER presentation_reference_examples_updated_at BEFORE UPDATE ON public.presentation_reference_examples
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 6. PRESENTATIONS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_presentations (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Generated at project level: one presentation per project.
    project_id           UUID        NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
    language             TEXT        NOT NULL DEFAULT 'en',
    status               TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved')),
    manual_inputs        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- { relevantDate, additionalContext, checkRecent } — the anchor event lives on the project.
    why_now_inputs       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    selected_why_now_id  UUID,
    -- The approved snapshot currently in use. Kept while a revision is drafted.
    approved_snapshot_id UUID,
    review_comment       TEXT,
    submitted_by         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    submitted_at         TIMESTAMPTZ,
    tokens_total         INTEGER     NOT NULL DEFAULT 0,
    web_searches         INTEGER     NOT NULL DEFAULT 0,
    cost_usd             NUMERIC(10, 6) NOT NULL DEFAULT 0,
    created_by           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commercial_presentations_status ON public.commercial_presentations (status, updated_at DESC);

DROP TRIGGER IF EXISTS commercial_presentations_updated_at ON public.commercial_presentations;
CREATE TRIGGER commercial_presentations_updated_at BEFORE UPDATE ON public.commercial_presentations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Every Generate / Alternative / Edit is one immutable row (append-only), so
-- Regenerate, Generate Alternative, Return to Previous Version and Select
-- Preferred Version are all just "point selected_why_now_id at a row".
CREATE TABLE IF NOT EXISTS public.presentation_why_now_versions (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    presentation_id    UUID        NOT NULL REFERENCES public.commercial_presentations(id) ON DELETE CASCADE,
    kind               TEXT        NOT NULL CHECK (kind IN ('generate', 'alternative', 'edit')),
    spoken_text        TEXT        NOT NULL,
    -- [{ fact, source }] — material facts from fresh external research only.
    new_external_facts JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- Which brief/letter/examples/inputs produced it (audit + "what changed").
    sources            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    research_used      BOOLEAN     NOT NULL DEFAULT FALSE,
    web_searches       INTEGER     NOT NULL DEFAULT 0,
    model              TEXT,
    tokens_total       INTEGER     NOT NULL DEFAULT 0,
    cost_usd           NUMERIC(10, 6) NOT NULL DEFAULT 0,
    created_by         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_presentation_why_now_versions_presentation
    ON public.presentation_why_now_versions (presentation_id, created_at DESC);

-- Exact approved snapshots. Never updated after insert.
CREATE TABLE IF NOT EXISTS public.presentation_snapshots (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    presentation_id    UUID        NOT NULL REFERENCES public.commercial_presentations(id) ON DELETE CASCADE,
    version_number     INTEGER     NOT NULL,
    blocks             JSONB       NOT NULL,
    -- [{ kind, id, refId, versionLabel }] — the master content versions used.
    master_refs        JSONB       NOT NULL DEFAULT '[]'::jsonb,
    manual_inputs      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    project_snapshot   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    why_now_version_id UUID,
    why_now_text       TEXT,
    new_external_facts JSONB       NOT NULL DEFAULT '[]'::jsonb,
    approved_by        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_on_approval BOOLEAN     NOT NULL DEFAULT FALSE,
    UNIQUE (presentation_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.presentation_events (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    presentation_id UUID        NOT NULL REFERENCES public.commercial_presentations(id) ON DELETE CASCADE,
    event_type      TEXT        NOT NULL,
    actor_id        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_presentation_events_presentation
    ON public.presentation_events (presentation_id, created_at DESC);

-- ------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- Every write goes through API routes using the service role. Signed-in
-- module users may read; admins may do anything.
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'agencies', 'projects', 'presentation_master_content', 'presentation_master_versions',
        'presentation_reference_examples', 'commercial_presentations',
        'presentation_why_now_versions', 'presentation_snapshots', 'presentation_events'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "Module users read %1$s" ON public.%1$I', t);
        EXECUTE format('CREATE POLICY "Module users read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.can_access_commercial_presentations())', t);
        EXECUTE format('DROP POLICY IF EXISTS "Admins manage %1$s" ON public.%1$I', t);
        EXECUTE format('CREATE POLICY "Admins manage %1$s" ON public.%1$I FOR ALL USING (public.user_role() = ''admin'')', t);
    END LOOP;
END $$;

-- Tell PostgREST to pick up the new tables and columns now.
NOTIFY pgrst, 'reload schema';
