-- ============================================================
-- 030 — Meeting Preparation: sample planteo audio
-- ============================================================
-- Idempotent, safe to re-run. Adds a private storage bucket holding a single
-- reference recording (an example of how a sales rep should deliver a
-- planteo) that every user with meeting-prep access can listen to — not a new
-- table, since this is one admin-uploaded file, not an admin-manageable
-- library. The app reads it via a service-role-minted signed URL
-- (src/app/(dashboard)/meeting-preparation/new/page.tsx and
-- src/app/(dashboard)/meeting-preparation/[id]/page.tsx), so the SELECT
-- policy below is defence-in-depth, not load-bearing.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('meeting-prep-samples', 'meeting-prep-samples', FALSE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can read meeting prep samples" ON storage.objects;
CREATE POLICY "Authenticated users can read meeting prep samples"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'meeting-prep-samples');

DROP POLICY IF EXISTS "Admins can manage meeting prep samples" ON storage.objects;
CREATE POLICY "Admins can manage meeting prep samples"
    ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'meeting-prep-samples' AND public.user_role() = 'admin')
    WITH CHECK (bucket_id = 'meeting-prep-samples' AND public.user_role() = 'admin');
