-- ============================================================
-- 039 — Central Media Library (client request, 19 Oct 2026)
-- ============================================================
-- One admin-managed list of publications (media partners) for every module,
-- instead of free text in some forms and three separate lists in others.
-- Run on any database that already ran 014 (Meeting Prep), 032 (Copywriting)
-- and 038 (Interview Letter media); each part is skipped when its module's
-- tables don't exist. Idempotent and SAFE TO RE-RUN. No data is deleted: the
-- three old tables are renamed to *_legacy and kept as a backup.
--
-- media_library holds, per publication:
--   • name + country — what every module's dropdown shows. Modules still
--     store the chosen NAME on their own rows (research_sessions.publication,
--     transcriptions.publication, document_sessions.media_partner, …), so
--     renaming or deleting a library entry never rewrites past work.
--   • Meeting Preparation's media profile — positioning_statement,
--     audience_reach, editorial_narrative_focus (from meeting_prep_media_library);
--   • Interview Letters' word-for-word letter_description (from interview_letter_media);
--   • Copywriting's writing_rules (from copywriting_publications.additional_rules).
--     Copywriting's style-guide files stay in copywriting_publication_guides,
--     now pointing at media_library.
--
-- Merging: rows are matched by name, ignoring case and surrounding spaces
-- ("The Economic Observer " = "The Economic Observer"). Meeting Prep's rows
-- go in first and keep their ids; a Copywriting / Letters row for the same
-- publication is merged into it (its extra fields filled in), and every
-- reference to the old id — copywriting_projects.publication_id,
-- copywriting_publication_guides.publication_id, interview_letter_projects.media_id,
-- meeting_prep_sessions.media_library_id — is moved to the merged row.
--
-- Compatibility: meeting_prep_media_library and copywriting_publications are
-- re-created as VIEWS over media_library, with their old column names, so the
-- code deployed before this migration keeps working (reads and admin edits)
-- until the new code is deployed. They can be dropped once it is.
--
-- After this has run, don't re-run 014 or 032 by hand: they would try to add
-- triggers / RLS to what is now a view. (Fresh installs run them first, in
-- order, so they're unaffected.)
-- ============================================================

-- ------------------------------------------------------------
-- 1. THE TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_library (
    id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                      TEXT        NOT NULL,
    -- Nullable only so the old Copywriting admin (which sends NULL for "no
    -- country") keeps working through its compatibility view. New code
    -- always writes '' or a country.
    country                   TEXT        DEFAULT '',
    -- Meeting Preparation media profile (US-022: a publication without one
    -- halts Meeting Prep at Step 1).
    positioning_statement     TEXT        NOT NULL DEFAULT '',
    audience_reach            TEXT        NOT NULL DEFAULT '',
    editorial_narrative_focus TEXT        NOT NULL DEFAULT '',
    -- Interview Letters: copied into the letter word for word wherever the
    -- template says [Approved Media Partner Description].
    letter_description        TEXT        NOT NULL DEFAULT '',
    -- Copywriting: publication-specific rules applied on top of TRC house rules.
    writing_rules             TEXT        NOT NULL DEFAULT '',
    created_by                UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by                UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS media_library_name_key
    ON public.media_library (lower(btrim(name)));

DROP TRIGGER IF EXISTS media_library_updated_at ON public.media_library;
CREATE TRIGGER media_library_updated_at
    BEFORE UPDATE ON public.media_library
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;

-- Any signed-in user may read (every module's dropdown); only admins write.
-- The app writes through the service role after its own admin check.
DROP POLICY IF EXISTS "Authenticated users can read the media library" ON public.media_library;
CREATE POLICY "Authenticated users can read the media library"
    ON public.media_library FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can manage the media library" ON public.media_library;
CREATE POLICY "Admins can manage the media library"
    ON public.media_library FOR ALL USING (public.user_role() = 'admin');

-- ------------------------------------------------------------
-- 2. MERGE THE OLD LISTS, MOVE THE REFERENCES, RENAME THE OLD TABLES
-- ------------------------------------------------------------
DO $$
DECLARE
    r        RECORD;
    c        RECORD;
    target   UUID;
    is_table BOOLEAN;
BEGIN
    CREATE TEMP TABLE IF NOT EXISTS media_library_id_map (old_id UUID PRIMARY KEY, new_id UUID NOT NULL) ON COMMIT DROP;

    -- 2a. Drop the foreign keys that point at the old tables (new ones are
    --     added in 2d, once the ids have moved).
    FOR c IN
        SELECT con.conname, con.conrelid::regclass AS tbl
          FROM pg_constraint con
         WHERE con.contype = 'f'
           AND con.confrelid IN (
                SELECT oid FROM pg_class
                 WHERE relkind = 'r'
                   AND oid IN (to_regclass('public.meeting_prep_media_library'),
                               to_regclass('public.copywriting_publications'),
                               to_regclass('public.interview_letter_media')))
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
    END LOOP;

    -- 2b. Copy each old list in (Meeting Prep first, so its ids are kept).
    SELECT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.meeting_prep_media_library') AND relkind = 'r') INTO is_table;
    IF is_table THEN
        FOR r IN EXECUTE 'SELECT * FROM public.meeting_prep_media_library ORDER BY created_at, id' LOOP
            SELECT id INTO target FROM public.media_library WHERE lower(btrim(name)) = lower(btrim(r.publication_name));
            IF target IS NULL THEN
                INSERT INTO public.media_library (id, name, country, positioning_statement, audience_reach, editorial_narrative_focus, created_by, created_at, updated_at)
                VALUES (r.id, btrim(r.publication_name), btrim(COALESCE(r.country_of_publication, '')), r.positioning_statement, r.audience_reach, r.editorial_narrative_focus, r.created_by, r.created_at, r.updated_at)
                RETURNING id INTO target;
            ELSE
                UPDATE public.media_library SET
                    country = CASE WHEN COALESCE(country, '') = '' THEN btrim(COALESCE(r.country_of_publication, '')) ELSE country END,
                    positioning_statement = CASE WHEN positioning_statement = '' THEN r.positioning_statement ELSE positioning_statement END,
                    audience_reach = CASE WHEN audience_reach = '' THEN r.audience_reach ELSE audience_reach END,
                    editorial_narrative_focus = CASE WHEN editorial_narrative_focus = '' THEN r.editorial_narrative_focus ELSE editorial_narrative_focus END
                 WHERE id = target;
            END IF;
            INSERT INTO media_library_id_map VALUES (r.id, target) ON CONFLICT (old_id) DO NOTHING;
        END LOOP;
    END IF;

    SELECT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.copywriting_publications') AND relkind = 'r') INTO is_table;
    IF is_table THEN
        FOR r IN EXECUTE 'SELECT * FROM public.copywriting_publications ORDER BY created_at, id' LOOP
            SELECT id INTO target FROM public.media_library WHERE lower(btrim(name)) = lower(btrim(r.name));
            IF target IS NULL THEN
                INSERT INTO public.media_library (id, name, country, writing_rules, created_by, created_at, updated_at)
                VALUES (r.id, btrim(r.name), btrim(COALESCE(r.country, '')), COALESCE(r.additional_rules, ''), r.created_by, r.created_at, r.updated_at)
                RETURNING id INTO target;
            ELSE
                UPDATE public.media_library SET
                    country = CASE WHEN COALESCE(country, '') = '' THEN btrim(COALESCE(r.country, '')) ELSE country END,
                    writing_rules = CASE WHEN writing_rules = '' THEN COALESCE(r.additional_rules, '') ELSE writing_rules END
                 WHERE id = target;
            END IF;
            INSERT INTO media_library_id_map VALUES (r.id, target) ON CONFLICT (old_id) DO NOTHING;
        END LOOP;
    END IF;

    SELECT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.interview_letter_media') AND relkind = 'r') INTO is_table;
    IF is_table THEN
        FOR r IN EXECUTE 'SELECT * FROM public.interview_letter_media ORDER BY created_at, id' LOOP
            SELECT id INTO target FROM public.media_library WHERE lower(btrim(name)) = lower(btrim(r.publication_name));
            IF target IS NULL THEN
                INSERT INTO public.media_library (id, name, country, letter_description, created_by, created_at, updated_at)
                VALUES (r.id, btrim(r.publication_name), btrim(COALESCE(r.country, '')), r.description, r.created_by, r.created_at, r.updated_at)
                RETURNING id INTO target;
            ELSE
                UPDATE public.media_library SET
                    country = CASE WHEN COALESCE(country, '') = '' THEN btrim(COALESCE(r.country, '')) ELSE country END,
                    letter_description = CASE WHEN letter_description = '' THEN r.description ELSE letter_description END
                 WHERE id = target;
            END IF;
            INSERT INTO media_library_id_map VALUES (r.id, target) ON CONFLICT (old_id) DO NOTHING;
        END LOOP;
    END IF;

    -- Der Spiegel is a current media partner (Interview Letters, Editorial
    -- Briefs) that was missing from both old lists.
    INSERT INTO public.media_library (name, country)
    SELECT 'Der Spiegel', 'Germany'
     WHERE NOT EXISTS (SELECT 1 FROM public.media_library WHERE lower(btrim(name)) = 'der spiegel');

    -- 2c. Move every reference to a merged row's id, and clear any reference
    --     to an id that no longer exists (defensive: the old FKs were SET NULL).
    IF to_regclass('public.meeting_prep_sessions') IS NOT NULL THEN
        UPDATE public.meeting_prep_sessions s SET media_library_id = m.new_id
          FROM media_library_id_map m WHERE s.media_library_id = m.old_id AND m.old_id <> m.new_id;
        UPDATE public.meeting_prep_sessions SET media_library_id = NULL
         WHERE media_library_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.media_library x WHERE x.id = media_library_id);
    END IF;
    IF to_regclass('public.copywriting_projects') IS NOT NULL THEN
        UPDATE public.copywriting_projects p SET publication_id = m.new_id
          FROM media_library_id_map m WHERE p.publication_id = m.old_id AND m.old_id <> m.new_id;
        UPDATE public.copywriting_projects SET publication_id = NULL
         WHERE publication_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.media_library x WHERE x.id = publication_id);
    END IF;
    IF to_regclass('public.copywriting_publication_guides') IS NOT NULL THEN
        -- A guide's storage path keeps its old "<publication id>/" folder;
        -- that's fine, the stored path is what's read.
        UPDATE public.copywriting_publication_guides g SET publication_id = m.new_id
          FROM media_library_id_map m WHERE g.publication_id = m.old_id AND m.old_id <> m.new_id;
    END IF;
    IF to_regclass('public.interview_letter_projects') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'interview_letter_projects' AND column_name = 'media_id') THEN
        EXECUTE 'UPDATE public.interview_letter_projects p SET media_id = m.new_id
                   FROM media_library_id_map m WHERE p.media_id = m.old_id AND m.old_id <> m.new_id';
        EXECUTE 'UPDATE public.interview_letter_projects SET media_id = NULL
                  WHERE media_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.media_library x WHERE x.id = media_id)';
    END IF;

    -- 2d. Point the foreign keys at media_library (only where missing).
    FOR c IN
        SELECT * FROM (VALUES
            ('meeting_prep_sessions',          'media_library_id', 'SET NULL'),
            ('copywriting_projects',           'publication_id',   'SET NULL'),
            ('copywriting_publication_guides', 'publication_id',   'CASCADE'),
            ('interview_letter_projects',      'media_id',         'SET NULL')
        ) AS v(tbl, col, on_delete)
    LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col)
           AND NOT EXISTS (
                SELECT 1 FROM pg_constraint con
                  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
                 WHERE con.contype = 'f'
                   AND con.conrelid = to_regclass('public.' || c.tbl)
                   AND con.confrelid = 'public.media_library'::regclass
                   AND a.attname = c.col) THEN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.media_library(id) ON DELETE %s',
                           c.tbl, c.tbl || '_' || c.col || '_media_fkey', c.col, c.on_delete);
        END IF;
    END LOOP;

    -- 2e. Keep the old tables as a backup under a new name.
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.meeting_prep_media_library') AND relkind = 'r')
       AND to_regclass('public.meeting_prep_media_library_legacy') IS NULL THEN
        ALTER TABLE public.meeting_prep_media_library RENAME TO meeting_prep_media_library_legacy;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.copywriting_publications') AND relkind = 'r')
       AND to_regclass('public.copywriting_publications_legacy') IS NULL THEN
        ALTER TABLE public.copywriting_publications RENAME TO copywriting_publications_legacy;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.interview_letter_media') AND relkind = 'r')
       AND to_regclass('public.interview_letter_media_legacy') IS NULL THEN
        ALTER TABLE public.interview_letter_media RENAME TO interview_letter_media_legacy;
    END IF;
END $$;

-- ------------------------------------------------------------
-- 3. COMPATIBILITY VIEWS (old names → media_library)
-- ------------------------------------------------------------
-- Simple one-table views, so Postgres lets the old code insert/update/delete
-- through them. Reads are limited to signed-in users and writes to the
-- service role (which is how the old code writes), matching the old tables'
-- policies; security_invoker makes the views apply media_library's RLS.
DO $$
DECLARE
    v RECORD;
BEGIN
    IF to_regclass('public.meeting_prep_media_library') IS NULL
       OR EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.meeting_prep_media_library') AND relkind = 'v') THEN
        EXECUTE $v$
            CREATE OR REPLACE VIEW public.meeting_prep_media_library AS
            SELECT id,
                   name    AS publication_name,
                   positioning_statement,
                   audience_reach,
                   editorial_narrative_focus,
                   country AS country_of_publication,
                   created_by,
                   created_at,
                   updated_at
              FROM public.media_library
        $v$;
    END IF;

    IF to_regclass('public.copywriting_publications') IS NULL
       OR EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.copywriting_publications') AND relkind = 'v') THEN
        EXECUTE $v$
            CREATE OR REPLACE VIEW public.copywriting_publications AS
            SELECT id,
                   name,
                   country,
                   writing_rules AS additional_rules,
                   created_by,
                   created_at,
                   updated_at
              FROM public.media_library
        $v$;
    END IF;

    FOR v IN SELECT unnest(ARRAY['meeting_prep_media_library', 'copywriting_publications']) AS name LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.' || v.name) AND relkind = 'v');
        IF current_setting('server_version_num')::INT >= 150000 THEN
            EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.name);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE format('REVOKE ALL ON public.%I FROM anon', v.name);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', v.name);
            EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v.name);
        END IF;
    END LOOP;
END $$;

-- Ask PostgREST to pick up the new table, views and foreign keys now.
NOTIFY pgrst, 'reload schema';
