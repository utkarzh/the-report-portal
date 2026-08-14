-- ============================================================
-- 015 — Advertiser Tracker library (Commercial Meeting Preparation)
-- ============================================================
-- Run this on an EXISTING database created from an earlier 001. Idempotent /
-- safe to re-run. Merged into 001_schema.sql for fresh installs.
--
-- TRC keeps a per-COUNTRY advertiser tracker spreadsheet (e.g. "Georgia TP
-- 2026"), updated weekly, listing every institution and whether it has
-- advertised before (Media / Ad size / Year). Meeting-prep sessions look up the
-- interviewee's company in the tracker for its country to auto-fill the
-- Commercial Alert, instead of the old manual yes/no entry.
--
-- One row per country (upsert on re-upload = the weekly update). We store the
-- PARSED rows as JSONB — the .xlsx itself isn't kept; only its extracted data
-- reaches the app. Depends on 001: update_updated_at(), user_role(), profiles.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meeting_prep_advertiser_tracker (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- One tracker per country (case-insensitive match handled in app code).
    country     TEXT        NOT NULL UNIQUE,
    filename    TEXT,
    -- Normalised rows: [{ type, company, status, deal_owner, city, notes,
    -- revenue, ad_size, media, year, link }]. Parsed server-side from the .xlsx.
    entries     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    row_count   INTEGER     NOT NULL DEFAULT 0,
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS meeting_prep_advertiser_tracker_updated_at ON public.meeting_prep_advertiser_tracker;
CREATE TRIGGER meeting_prep_advertiser_tracker_updated_at
    BEFORE UPDATE ON public.meeting_prep_advertiser_tracker
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.meeting_prep_advertiser_tracker ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read (session lookup at Step 1). Writes go through
-- the service role in API routes, which enforce meeting-prep access there.
DROP POLICY IF EXISTS "Authenticated users can read advertiser tracker" ON public.meeting_prep_advertiser_tracker;
CREATE POLICY "Authenticated users can read advertiser tracker"
    ON public.meeting_prep_advertiser_tracker FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can manage advertiser tracker" ON public.meeting_prep_advertiser_tracker;
CREATE POLICY "Admins can manage advertiser tracker"
    ON public.meeting_prep_advertiser_tracker FOR ALL USING (public.user_role() = 'admin');
