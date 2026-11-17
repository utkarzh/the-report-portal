-- ============================================================
-- 047 — Central agency list (shared by every module)
-- ============================================================
-- Run after 046 (which created public.agencies for Commercial
-- Presentations). Idempotent and SAFE TO RE-RUN. Never rewrites existing
-- letters, templates, prompts or projects.
--
-- Until now agencies were hard-coded per module: Interview Letters had a
-- CHECK (company IN ('TRC','GFDI')) on seven tables, and the export branding
-- registry hard-coded the same two brands. This makes public.agencies the
-- one admin-managed list (Admin → Agencies), the way 039 did for the Media
-- Library:
--
--   1. agencies.code — the short, stable identifier every module stores
--      (TRC, GFDI, …). Interview Letters already stores exactly these codes
--      in its `company` columns, so every existing row stays valid as is.
--   2. agencies.brand_family — added for a planned "export artwork" setting
--      that was later dropped as unnecessary; the app does not read it.
--      Exports pick TRC/GFDI artwork from the agency code.
--   3. Interview Letters' seven fixed CHECKs are replaced by a foreign key
--      to agencies(code) (ON UPDATE CASCADE). interview_letter_samples keeps
--      its 'any' option, so it gets a plain non-empty check instead and the
--      app validates the code.
--   4. agencies.letter_company (from 046) is superseded by `code` and no
--      longer read. It is left in place (no destructive change).
-- ============================================================

DO $$
BEGIN
    IF to_regclass('public.agencies') IS NULL THEN
        RAISE EXCEPTION 'Run 046_commercial_presentations.sql before 047_central_agencies.sql';
    END IF;
END $$;

-- ------------------------------------------------------------
-- 1. code + brand_family
-- ------------------------------------------------------------
ALTER TABLE public.agencies
    ADD COLUMN IF NOT EXISTS code         TEXT,
    ADD COLUMN IF NOT EXISTS brand_family TEXT;

-- The two seeded agencies keep the codes Interview Letters already uses.
UPDATE public.agencies SET code = letter_company
WHERE code IS NULL AND letter_company IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.agencies a2 WHERE a2.code = public.agencies.letter_company);

-- Any other agency gets a code from its initials (e.g. "Asia Business
-- Reports" → ABR), made unique with a number when needed.
DO $$
DECLARE
    r      RECORD;
    base   TEXT;
    cand   TEXT;
    n      INTEGER;
BEGIN
    FOR r IN SELECT id, name FROM public.agencies WHERE code IS NULL ORDER BY created_at LOOP
        base := upper(regexp_replace(
            (SELECT string_agg(left(w, 1), '') FROM regexp_split_to_table(r.name, '\s+') AS w WHERE w <> ''),
            '[^A-Za-z0-9]', '', 'g'));
        IF base IS NULL OR length(base) < 2 THEN
            base := upper(left(regexp_replace(r.name, '[^A-Za-z0-9]', '', 'g') || 'AG', 6));
        END IF;
        base := left(base, 10);
        cand := base;
        n := 2;
        WHILE EXISTS (SELECT 1 FROM public.agencies WHERE code = cand) LOOP
            cand := left(base, 9) || n;
            n := n + 1;
        END LOOP;
        UPDATE public.agencies SET code = cand WHERE id = r.id;
    END LOOP;
END $$;

-- Every code Interview Letters already uses must exist as an agency before
-- the foreign keys go on (defensive: normally just TRC and GFDI).
INSERT INTO public.agencies (name, code, letter_company)
SELECT CASE c.code WHEN 'TRC' THEN 'The Report Company' WHEN 'GFDI' THEN 'Global FDI Reports' ELSE c.code END,
       c.code,
       CASE WHEN c.code IN ('TRC', 'GFDI') THEN c.code END
FROM (
    SELECT DISTINCT company AS code FROM public.interview_letter_projects
    UNION SELECT DISTINCT company FROM public.interview_letter_templates
    UNION SELECT DISTINCT company FROM public.interview_letter_research_prompts
    UNION SELECT DISTINCT company FROM public.interview_letter_email_prompts
    UNION SELECT 'TRC' UNION SELECT 'GFDI'
) c
WHERE c.code IS NOT NULL AND c.code <> 'any'
  AND NOT EXISTS (SELECT 1 FROM public.agencies a WHERE a.code = c.code)
  AND NOT EXISTS (SELECT 1 FROM public.agencies a WHERE lower(btrim(a.name)) = lower(CASE c.code WHEN 'TRC' THEN 'The Report Company' WHEN 'GFDI' THEN 'Global FDI Reports' ELSE c.code END));

UPDATE public.agencies SET brand_family = code
WHERE brand_family IS NULL AND code IN ('TRC', 'GFDI');

ALTER TABLE public.agencies ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agencies_code ON public.agencies (code);
ALTER TABLE public.agencies DROP CONSTRAINT IF EXISTS agencies_code_format;
ALTER TABLE public.agencies ADD CONSTRAINT agencies_code_format CHECK (code ~ '^[A-Z0-9]{2,12}$');
ALTER TABLE public.agencies DROP CONSTRAINT IF EXISTS agencies_brand_family_check;
ALTER TABLE public.agencies ADD CONSTRAINT agencies_brand_family_check CHECK (brand_family IS NULL OR brand_family IN ('TRC', 'GFDI'));

COMMENT ON COLUMN public.agencies.letter_company IS 'Deprecated by agencies.code (migration 047); no longer read.';

-- ------------------------------------------------------------
-- 2. Interview Letters: fixed TRC/GFDI checks → foreign key to agencies(code)
-- ------------------------------------------------------------
DO $$
DECLARE
    t      TEXT;
    c      RECORD;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'interview_letter_templates', 'interview_letter_templates_versions',
        'interview_letter_research_prompts', 'interview_letter_research_prompts_versions',
        'interview_letter_email_prompts', 'interview_letter_email_prompts_versions',
        'interview_letter_projects', 'interview_letter_samples'
    ] LOOP
        IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

        -- Drop the old hard-coded company CHECK (whatever it was named).
        FOR c IN
            SELECT conname FROM pg_constraint
            WHERE conrelid = ('public.' || t)::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%company%'
              AND pg_get_constraintdef(oid) LIKE '%TRC%'
        LOOP
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, c.conname);
        END LOOP;

        IF t = 'interview_letter_samples' THEN
            -- 'any' = a style sample for every agency; the app validates codes.
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_company_not_blank');
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (btrim(company) <> '''')', t, t || '_company_not_blank');
        ELSIF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = t || '_company_agency_fk'
        ) THEN
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company) REFERENCES public.agencies(code) ON UPDATE CASCADE',
                t, t || '_company_agency_fk');
        END IF;
    END LOOP;
END $$;

-- Every signed-in user may read the agency list (every module's dropdown);
-- only admins write (046 already added the admin policy).
DROP POLICY IF EXISTS "Signed-in users read agencies" ON public.agencies;
CREATE POLICY "Signed-in users read agencies" ON public.agencies FOR SELECT TO authenticated USING (TRUE);

NOTIFY pgrst, 'reload schema';
