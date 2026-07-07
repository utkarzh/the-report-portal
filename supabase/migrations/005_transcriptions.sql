-- ============================================================
-- 005 — Transcriptions module
-- ============================================================
-- Run this on an EXISTING production database created from 001 before this
-- feature. Fresh databases already have everything (it is merged into
-- 001_schema.sql). Every statement is idempotent and SAFE TO RE-RUN — it uses
-- IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP POLICY IF EXISTS throughout and
-- never drops or alters existing data.
--
-- What it adds:
--   1. transcript_prompt            — singleton "refining prompt" (mirrors general_prompt)
--   2. transcript_prompt_versions   — full version history (mirrors general_prompt_versions)
--   3. transcriptions               — one row per uploaded audio + its transcripts
--   4. transcription-audio          — private Storage bucket + RLS for the audio files
--
-- Depends on objects already created by 001: public.update_updated_at(),
-- public.user_role(), public.profiles, and the uuid_generate_v4() extension.
-- ============================================================

-- ------------------------------------------------------------
-- 1. REFINING PROMPT (singleton, like general_prompt)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transcript_prompt (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_text TEXT        NOT NULL DEFAULT '',
    updated_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce exactly one row (same trick as general_prompt).
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_prompt_singleton
    ON public.transcript_prompt((TRUE));

-- Seed the single row only if the table is empty. Re-running never duplicates it.
-- Dollar-quoted ($seed$…$seed$) so the multi-line prompt with apostrophes parses
-- cleanly and does not trip the SQL editor's linter.
INSERT INTO public.transcript_prompt (prompt_text)
SELECT $seed$You are an expert editorial transcript editor for The Report Company. You are given the RAW machine transcript of a recorded interview. Produce a clean, readable, publication-ready version of it.

Rules:
- Transcribe word-for-word, exactly as spoken. Preserve the speaker's meaning and all key facts exactly. Never invent or add content that is not in the transcript.
- Fix punctuation and capitalisation, and correct obvious speech-to-text errors — but do not otherwise reword, paraphrase, or trim what was said.
- Do NOT label or guess speakers. The audio does not identify who is speaking, so never add "Speaker 1", names, or any speaker attribution.
- Break the text into readable paragraphs where there are natural pauses or topic shifts.
- Keep a professional, faithful editorial tone. Do not summarise or omit substance — this is a verbatim cleaned transcript, not a summary.$seed$
WHERE NOT EXISTS (SELECT 1 FROM public.transcript_prompt);

-- ------------------------------------------------------------
-- 2. REFINING PROMPT VERSION HISTORY (like general_prompt_versions)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transcript_prompt_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_text TEXT        NOT NULL,
    saved_by    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_prompt_versions_created_at
    ON public.transcript_prompt_versions(created_at DESC);

-- ------------------------------------------------------------
-- 3. TRANSCRIPTIONS
-- ------------------------------------------------------------
-- Mirrors research_sessions: user_id is nullable and SET NULL on profile delete
-- so a transcript's history survives when its author is permanently deleted.
CREATE TABLE IF NOT EXISTS public.transcriptions (
    id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    title                     TEXT        NOT NULL DEFAULT 'Untitled transcript',
    -- Storage object path of the ORIGINAL uploaded file (used for playback),
    -- inside the private 'transcription-audio' bucket.
    audio_path                TEXT        NOT NULL,
    -- Ordered storage paths of the 16kHz-mono audio chunks produced in-browser
    -- by ffmpeg.wasm. Long audio is split so each chunk stays under OpenAI's
    -- 25 MB / ~25 min transcription limits and each transcribes in one short
    -- serverless request. Empty/NULL means "transcribe audio_path directly".
    chunk_paths               TEXT[],
    -- Per-chunk raw transcript text, filled in as each chunk completes. Once all
    -- slots are populated they are joined into raw_transcript.
    chunk_transcripts         TEXT[],
    audio_filename            TEXT,
    audio_mime                TEXT,
    audio_size_bytes          BIGINT,
    duration_seconds          NUMERIC,
    -- Lifecycle: uploaded -> transcribing -> transcribed -> refining -> refined.
    -- 'failed' is terminal for whichever step errored.
    status                    TEXT        NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded','transcribing','transcribed','refining','refined','failed')),
    raw_transcript            TEXT,
    refined_transcript        TEXT,
    -- Snapshot of the refining prompt actually used, taken at refine time.
    refining_prompt_snapshot  TEXT,
    transcribe_model          TEXT,
    -- Claude token accounting for the refine step (whisper is billed separately).
    tokens_input              INTEGER     DEFAULT 0,
    tokens_output             INTEGER     DEFAULT 0,
    tokens_total              INTEGER     DEFAULT 0,
    cost_usd                  NUMERIC(10, 6) DEFAULT 0,
    error                     TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_user_id
    ON public.transcriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
    ON public.transcriptions(created_at DESC);

-- updated_at maintenance (reuses the shared trigger fn from 001). CREATE TRIGGER
-- has no IF NOT EXISTS, so drop-then-create to stay idempotent.
DROP TRIGGER IF EXISTS transcriptions_updated_at ON public.transcriptions;
CREATE TRIGGER transcriptions_updated_at
    BEFORE UPDATE ON public.transcriptions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.transcript_prompt          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcriptions             ENABLE ROW LEVEL SECURITY;

-- Refining prompt: everyone authenticated may read it (needed to refine),
-- only admins may change it. Version rows are admin-only. Writes from API
-- routes go through the service role, which bypasses RLS.
DROP POLICY IF EXISTS "Authenticated users can read transcript prompt" ON public.transcript_prompt;
CREATE POLICY "Authenticated users can read transcript prompt"
    ON public.transcript_prompt FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "Admins can update transcript prompt" ON public.transcript_prompt;
CREATE POLICY "Admins can update transcript prompt"
    ON public.transcript_prompt FOR UPDATE USING (public.user_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage transcript prompt versions" ON public.transcript_prompt_versions;
CREATE POLICY "Admins can manage transcript prompt versions"
    ON public.transcript_prompt_versions FOR ALL USING (public.user_role() = 'admin');

-- Transcriptions: users see/manage their own, admins see all (mirrors
-- research_sessions). Privileged writes still happen via the service role.
DROP POLICY IF EXISTS "Users can read own transcriptions" ON public.transcriptions;
CREATE POLICY "Users can read own transcriptions"
    ON public.transcriptions FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins can read all transcriptions" ON public.transcriptions;
CREATE POLICY "Admins can read all transcriptions"
    ON public.transcriptions FOR SELECT USING (public.user_role() = 'admin');
DROP POLICY IF EXISTS "Users can insert own transcriptions" ON public.transcriptions;
CREATE POLICY "Users can insert own transcriptions"
    ON public.transcriptions FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can update own transcriptions" ON public.transcriptions;
CREATE POLICY "Users can update own transcriptions"
    ON public.transcriptions FOR UPDATE USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 5. STORAGE — private audio bucket
-- ------------------------------------------------------------
-- Private bucket; files are served to the app via short-lived signed URLs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('transcription-audio', 'transcription-audio', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Object paths are "<user_id>/<uuid>.<ext>". Users may manage only the files in
-- their own top-level folder; admins may read every file. The API's service
-- role bypasses these for server-side download/transcription.
DROP POLICY IF EXISTS "Users manage own transcription audio" ON storage.objects;
CREATE POLICY "Users manage own transcription audio"
    ON storage.objects FOR ALL TO authenticated
    USING (
        bucket_id = 'transcription-audio'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'transcription-audio'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "Admins read all transcription audio" ON storage.objects;
CREATE POLICY "Admins read all transcription audio"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'transcription-audio'
        AND public.user_role() = 'admin'
    );
