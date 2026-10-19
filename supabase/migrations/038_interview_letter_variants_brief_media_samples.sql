-- ============================================================
-- 038 — Interview Letters: anchor / no-anchor versions, Editorial Brief +
--       Gemini research, Media library, sample letters (client request,
--       18 Oct 2026)
-- ============================================================
-- Run on any database that already ran 021–023. Idempotent and SAFE TO
-- RE-RUN — IF NOT EXISTS / WHERE NOT EXISTS / DROP POLICY IF EXISTS
-- throughout; never drops or rewrites existing data.
--
-- What it adds:
--   1. interview_letter_settings — singleton admin config. research_provider
--      picks the engine for the research step ('gemini' default, or
--      'claude'). Every write-up (letter, email, personalization) stays on
--      Claude regardless.
--   2. Two letter versions per company — interview_letter_templates (and its
--      _versions) gain `variant` ('anchor' | 'no_anchor'); uniqueness moves
--      from (company) to (company, variant). The existing template of each
--      company becomes its 'no_anchor' version (it opens with the report's
--      purpose and gives publication timing later, which is exactly that
--      version). The 'anchor' version is seeded from it: an anchor paragraph
--      is inserted right after the first variable paragraph (so it is the
--      letter's second paragraph) and the separate "publication_hook" timing
--      slot, if present, is dropped (the anchor paragraph carries timing).
--   3. interview_letter_media — the Media library: one row per publication
--      with its exact, word-for-word description. The app copies it verbatim
--      into the letter wherever the template says
--      [Approved Media Partner Description].
--   4. interview_letter_samples (+ private 'interview-letter-samples'
--      bucket) — admin-uploaded sample letters tagged by company, version
--      and sector; the most relevant ones are handed to Claude as style
--      references when a letter is drafted.
--   5. New interview_letter_projects columns: letter version + anchor +
--      publication timing + report sector, the linked Editorial Brief (FK +
--      title + text snapshot), the matched Media library entry (FK + verbatim
--      description snapshot), which research engine ran, the research's
--      "updates since the brief" and "cautions" lists, and which samples were
--      used.
--
-- Depends on 001 (update_updated_at, user_role, profiles, uuid_generate_v4),
-- 012 (document_sessions) and 021.
-- ============================================================

-- ------------------------------------------------------------
-- 1. SETTINGS (singleton)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_letter_settings (
    id                INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    research_provider TEXT        NOT NULL DEFAULT 'gemini'
        CHECK (research_provider IN ('gemini', 'claude')),
    updated_by        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.interview_letter_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS interview_letter_settings_updated_at ON public.interview_letter_settings;
CREATE TRIGGER interview_letter_settings_updated_at
    BEFORE UPDATE ON public.interview_letter_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. TEMPLATE VARIANTS
-- ------------------------------------------------------------
ALTER TABLE public.interview_letter_templates
    ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'no_anchor';
ALTER TABLE public.interview_letter_templates_versions
    ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'no_anchor';

DO $$
DECLARE
    c RECORD;
BEGIN
    -- Drop the old single-column UNIQUE (company), whatever it was named.
    FOR c IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = 'public'
           AND rel.relname = 'interview_letter_templates'
           AND con.contype = 'u'
           AND array_length(con.conkey, 1) = 1
           AND con.conkey[1] = (SELECT attnum FROM pg_attribute
                                 WHERE attrelid = rel.oid AND attname = 'company')
    LOOP
        EXECUTE format('ALTER TABLE public.interview_letter_templates DROP CONSTRAINT %I', c.conname);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_letter_templates_variant_check') THEN
        ALTER TABLE public.interview_letter_templates
            ADD CONSTRAINT interview_letter_templates_variant_check CHECK (variant IN ('anchor', 'no_anchor'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_letter_templates_versions_variant_check') THEN
        ALTER TABLE public.interview_letter_templates_versions
            ADD CONSTRAINT interview_letter_templates_versions_variant_check CHECK (variant IN ('anchor', 'no_anchor'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS interview_letter_templates_company_variant_key
    ON public.interview_letter_templates(company, variant);
CREATE INDEX IF NOT EXISTS idx_interview_letter_templates_versions_company_variant_created
    ON public.interview_letter_templates_versions(company, variant, created_at DESC);

-- Seed each company's 'anchor' version from its 'no_anchor' one.
WITH src AS (
    SELECT company, structure
      FROM public.interview_letter_templates t
     WHERE t.variant = 'no_anchor'
       AND jsonb_typeof(t.structure) = 'array'
       AND NOT EXISTS (
            SELECT 1 FROM public.interview_letter_templates a
             WHERE a.company = t.company AND a.variant = 'anchor')
),
elems AS (
    SELECT s.company, e.value AS slot, e.ord
      FROM src s, jsonb_array_elements(s.structure) WITH ORDINALITY AS e(value, ord)
),
anchor_pos AS (
    SELECT s.company,
           COALESCE((SELECT MIN(ord) FROM elems e WHERE e.company = s.company AND e.slot->>'type' = 'variable'),
                    (SELECT MIN(ord) FROM elems e WHERE e.company = s.company),
                    0) AS ord
      FROM src s
),
merged AS (
    SELECT company, slot, ord * 10 AS sort
      FROM elems
     WHERE slot->>'key' IS DISTINCT FROM 'publication_hook'
    UNION ALL
    SELECT company, $anchor${
      "key": "anchor",
      "type": "variable",
      "label": "Anchor — Event or Publication Occasion",
      "wordBudget": 60,
      "instructions": "Introduce the report's anchor — the event or publication occasion supplied with the project (see LETTER VERSION) — and explain in one or two sentences how it connects to the report and why it makes this the right moment for the interview. Use the anchor's verified name, dates and place from the research; never invent details of it. If publication timing is confirmed, state it here in relation to the anchor. Do not restate the report introduction."
    }$anchor$::jsonb, ord * 10 + 5
      FROM anchor_pos
)
INSERT INTO public.interview_letter_templates (company, variant, structure)
SELECT company, 'anchor', jsonb_agg(slot ORDER BY sort)
  FROM merged
 GROUP BY company
ON CONFLICT (company, variant) DO NOTHING;

-- ------------------------------------------------------------
-- 3. MEDIA LIBRARY
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_letter_media (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    publication_name TEXT        NOT NULL,
    country          TEXT        NOT NULL DEFAULT '',
    -- Copied into the letter word for word — never rewritten by the model.
    description      TEXT        NOT NULL,
    created_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS interview_letter_media_name_key
    ON public.interview_letter_media (lower(btrim(publication_name)));

DROP TRIGGER IF EXISTS interview_letter_media_updated_at ON public.interview_letter_media;
CREATE TRIGGER interview_letter_media_updated_at
    BEFORE UPDATE ON public.interview_letter_media
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 4. SAMPLE LETTERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_letter_samples (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    title          TEXT        NOT NULL,
    company        TEXT        NOT NULL DEFAULT 'any'
        CHECK (company IN ('TRC', 'GFDI', 'any')),
    variant        TEXT        NOT NULL DEFAULT 'any'
        CHECK (variant IN ('anchor', 'no_anchor', 'any')),
    -- Free text, comma-separated for several: "Tourism", "Security, Defence".
    sector         TEXT        NOT NULL DEFAULT '',
    notes          TEXT        NOT NULL DEFAULT '',
    filename       TEXT        NOT NULL,
    storage_path   TEXT        NOT NULL,
    mime           TEXT,
    size_bytes     BIGINT,
    extracted_text TEXT        NOT NULL DEFAULT '',
    char_count     INTEGER     DEFAULT 0,
    truncated      BOOLEAN     NOT NULL DEFAULT FALSE,
    uploaded_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_letter_samples_created
    ON public.interview_letter_samples(created_at DESC);

DROP TRIGGER IF EXISTS interview_letter_samples_updated_at ON public.interview_letter_samples;
CREATE TRIGGER interview_letter_samples_updated_at
    BEFORE UPDATE ON public.interview_letter_samples
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 5. PROJECT COLUMNS
-- ------------------------------------------------------------
-- Existing projects were all drafted from the template that is now the
-- 'no_anchor' version, so that's the backfilled default.
ALTER TABLE public.interview_letter_projects
    ADD COLUMN IF NOT EXISTS letter_variant TEXT NOT NULL DEFAULT 'no_anchor',
    ADD COLUMN IF NOT EXISTS anchor TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS publication_timing TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS report_sector TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS editorial_brief_id UUID REFERENCES public.document_sessions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS editorial_brief_title TEXT,
    ADD COLUMN IF NOT EXISTS editorial_brief_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS media_id UUID REFERENCES public.interview_letter_media(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS media_description_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS research_provider TEXT,
    ADD COLUMN IF NOT EXISTS research_updates JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS research_cautions JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS samples_used JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_letter_projects_letter_variant_check') THEN
        ALTER TABLE public.interview_letter_projects
            ADD CONSTRAINT interview_letter_projects_letter_variant_check CHECK (letter_variant IN ('anchor', 'no_anchor'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_letter_projects_research_provider_check') THEN
        ALTER TABLE public.interview_letter_projects
            ADD CONSTRAINT interview_letter_projects_research_provider_check CHECK (research_provider IS NULL OR research_provider IN ('gemini', 'claude'));
    END IF;
END $$;

-- ------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ------------------------------------------------------------
-- The app reads and writes all three tables through the service role after
-- its own access checks; these policies only matter for direct client access.
ALTER TABLE public.interview_letter_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_media    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_letter_samples  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage letter settings" ON public.interview_letter_settings;
CREATE POLICY "Admins can manage letter settings"
    ON public.interview_letter_settings FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Authenticated users can read letter media" ON public.interview_letter_media;
CREATE POLICY "Authenticated users can read letter media"
    ON public.interview_letter_media FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can manage letter media" ON public.interview_letter_media;
CREATE POLICY "Admins can manage letter media"
    ON public.interview_letter_media FOR ALL USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage letter samples" ON public.interview_letter_samples;
CREATE POLICY "Admins can manage letter samples"
    ON public.interview_letter_samples FOR ALL USING (public.user_role() = 'admin');

-- ------------------------------------------------------------
-- 7. STORAGE — private sample-letters bucket
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('interview-letter-samples', 'interview-letter-samples', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Object paths are "<user_id>/<uuid>.<ext>" (same scheme as document-samples).
-- Uploads are admin-only in app code; the folder-scoped policy lets the
-- uploading admin manage their own files and a second policy lets any admin
-- read every sample. The service role bypasses both for server-side
-- download/extraction.
DROP POLICY IF EXISTS "Users manage own interview letter samples" ON storage.objects;
CREATE POLICY "Users manage own interview letter samples"
    ON storage.objects FOR ALL TO authenticated
    USING (
        bucket_id = 'interview-letter-samples'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'interview-letter-samples'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Admins read all interview letter samples" ON storage.objects;
CREATE POLICY "Admins read all interview letter samples"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'interview-letter-samples'
        AND public.user_role() = 'admin'
    );
