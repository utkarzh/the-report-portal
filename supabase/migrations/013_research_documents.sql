-- ============================================================
-- 013 — Company documents for the Interview tool
-- ============================================================
-- Run this on an EXISTING production database created from an earlier 001.
-- Fresh databases already have everything (merged into 001_schema.sql).
-- Every statement is idempotent and SAFE TO RE-RUN — IF NOT EXISTS /
-- ON CONFLICT DO NOTHING / DROP POLICY IF EXISTS throughout; never drops or
-- alters existing data.
--
-- Lets a user (or admin) attach company documents — annual reports,
-- sustainability reports, etc. — on the "new interview" details screen. Each
-- file's text is extracted server-side (docx/pdf/txt/md) and fed to Claude as
-- supporting context during research + question generation. The original file
-- is kept in a private bucket; extracted_text is what actually reaches Claude.
--
-- Depends on objects already created by 001: public.user_role(),
-- public.research_sessions, public.profiles, and uuid_generate_v4().
-- ============================================================

CREATE TABLE IF NOT EXISTS public.research_documents (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Cascade so a session's attached docs are removed with it. (The storage
    -- objects are cleaned up by the session DELETE API route.)
    session_id     UUID        NOT NULL REFERENCES public.research_sessions(id) ON DELETE CASCADE,
    -- Denormalised owner for simple RLS (mirrors the folder-scoped bucket).
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

CREATE INDEX IF NOT EXISTS idx_research_documents_session
    ON public.research_documents(session_id, created_at);

ALTER TABLE public.research_documents ENABLE ROW LEVEL SECURITY;

-- Users manage their own docs; admins see all. Privileged reads at generate
-- time go through the service role (bypasses RLS).
DROP POLICY IF EXISTS "Users manage own research documents" ON public.research_documents;
CREATE POLICY "Users manage own research documents"
    ON public.research_documents FOR ALL USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read all research documents" ON public.research_documents;
CREATE POLICY "Admins read all research documents"
    ON public.research_documents FOR SELECT USING (public.user_role() = 'admin');

-- ------------------------------------------------------------
-- Private storage bucket (mirrors document-samples from 012)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('research-documents', 'research-documents', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Object paths are "<user_id>/<session_id>/<uuid>.<ext>". Users manage only
-- files in their own top-level folder; admins may read every file. The service
-- role bypasses these for server-side download/extraction.
DROP POLICY IF EXISTS "Users manage own research documents storage" ON storage.objects;
CREATE POLICY "Users manage own research documents storage"
    ON storage.objects FOR ALL TO authenticated
    USING (
        bucket_id = 'research-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'research-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Admins read all research documents storage" ON storage.objects;
CREATE POLICY "Admins read all research documents storage"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'research-documents'
        AND public.user_role() = 'admin'
    );
