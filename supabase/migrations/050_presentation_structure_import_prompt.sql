-- ============================================================
-- 050 — Commercial Presentations: editable "read a document" instructions
-- ============================================================
-- Run after 046. Idempotent and SAFE TO RE-RUN. Changes no data.
--
-- Admin → Structure & locked methodology → "Build from a document" reads an
-- uploaded file with Claude. Its instructions are now admin-editable and
-- versioned like every other master content, stored as one
-- presentation_master_content row of the new kind 'structure_import_prompt'
-- ({ prompt }). No row is seeded: with none, the built-in default in code is
-- used (DEFAULT_STRUCTURE_IMPORT_PROMPT). This only widens the kind CHECK.
-- ============================================================

DO $$
BEGIN
    IF to_regclass('public.presentation_master_content') IS NULL THEN
        RAISE EXCEPTION 'Run 046_commercial_presentations.sql before 050_presentation_structure_import_prompt.sql';
    END IF;
END $$;

DO $$
DECLARE c RECORD;
BEGIN
    -- Drop the kind CHECK whatever it was named.
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.presentation_master_content'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%kind%'
          AND pg_get_constraintdef(oid) LIKE '%why_now_prompt%'
    LOOP
        EXECUTE format('ALTER TABLE public.presentation_master_content DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE public.presentation_master_content
    ADD CONSTRAINT presentation_master_content_kind_check
    CHECK (kind IN ('structure', 'agency', 'media', 'why_now_prompt', 'structure_import_prompt'));

NOTIFY pgrst, 'reload schema';
