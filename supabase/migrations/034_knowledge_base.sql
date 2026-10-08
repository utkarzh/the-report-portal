-- ============================================================
-- 034 — TRC Knowledge Base (Module 7, US-097 → US-123)
-- ============================================================
-- Staff ask how TRC does something and get answers ONLY from approved,
-- published company knowledge. Knowledge is organised by department; each
-- department is both a knowledge space and a permission boundary, owned by
-- exactly one Guardian who is the only person allowed to publish it.
--
-- Run after 001 and 025–033, in order. Idempotent (IF NOT EXISTS / DROP ...
-- IF EXISTS / CREATE OR REPLACE) — safe to re-run.
--
-- Access model: every table here has RLS ENABLED WITH NO POLICIES, so the
-- anon/authenticated roles can read nothing directly. All reads and writes go
-- through API routes / server components using the service role, which check
-- department membership live on every request (US-099: "no leftover access
-- from cache"). That keeps the department boundary in one place
-- (src/lib/knowledge/access.ts) instead of duplicated across SQL policies.
--
-- Search: hybrid full-text (tsvector, always available) + semantic (pgvector,
-- populated only when OPENAI_API_KEY is configured), fused with reciprocal
-- rank fusion in knowledge_search(). Only chunks belonging to an item's
-- CURRENT published version are ever searchable, so publishing a new version
-- is a single pointer flip — the old and new versions are never both live
-- (US-106) and drafts never affect answers (US-105).
-- ============================================================

-- ------------------------------------------------------------
-- 1. PER-USER MODULE ACCESS (US-097) — same pattern as every other module
-- ------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_access_knowledge_base BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.invitations
    ADD COLUMN IF NOT EXISTS can_access_knowledge_base BOOLEAN NOT NULL DEFAULT FALSE;

-- Re-declare handle_new_user to also copy the new invite flag. Preserves every
-- column it already sets (up to migration 032).
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
        can_access_knowledge_base
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
             ELSE COALESCE(v_invite.can_access_knowledge_base, FALSE) END
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

-- pgvector for semantic search (Supabase ships it; lives in `extensions`).
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 2. DEPARTMENTS + MEMBERSHIP (US-098, US-099, US-122)
-- ------------------------------------------------------------
-- guardian_id is nullable (SET NULL on profile delete): a department with no
-- Guardian — or a deactivated one — stays live but read-only (US-122).
CREATE TABLE IF NOT EXISTS public.knowledge_departments (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',
    guardian_id  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    archived_at  TIMESTAMPTZ,
    created_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_departments_guardian_idx ON public.knowledge_departments(guardian_id);

DROP TRIGGER IF EXISTS knowledge_departments_updated_at ON public.knowledge_departments;
CREATE TRIGGER knowledge_departments_updated_at
    BEFORE UPDATE ON public.knowledge_departments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS public.knowledge_department_members (
    department_id UUID        NOT NULL REFERENCES public.knowledge_departments(id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    added_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (department_id, user_id)
);
CREATE INDEX IF NOT EXISTS knowledge_department_members_user_idx ON public.knowledge_department_members(user_id);

-- ------------------------------------------------------------
-- 3. TOPICS (US-101)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_topics (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    department_id UUID        NOT NULL REFERENCES public.knowledge_departments(id) ON DELETE CASCADE,
    name          TEXT        NOT NULL,
    position      INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_topics_department_idx ON public.knowledge_topics(department_id, position);

DROP TRIGGER IF EXISTS knowledge_topics_updated_at ON public.knowledge_topics;
CREATE TRIGGER knowledge_topics_updated_at
    BEFORE UPDATE ON public.knowledge_topics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 4. ITEMS + VERSIONS (US-100, US-102 → US-108)
-- ------------------------------------------------------------
-- One row per piece of knowledge. `published_version_id` is THE live version
-- (the only one users see and the AI searches); `draft_version_id` is the
-- pending edit, if any. title/description mirror the published version (or
-- the draft, before the first publish) so lists don't need a join.
CREATE TABLE IF NOT EXISTS public.knowledge_items (
    id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    department_id         UUID        NOT NULL REFERENCES public.knowledge_departments(id) ON DELETE CASCADE,
    topic_id              UUID        REFERENCES public.knowledge_topics(id) ON DELETE SET NULL,
    type                  TEXT        NOT NULL CHECK (type IN ('document', 'text', 'video', 'link')),
    title                 TEXT        NOT NULL,
    description           TEXT        NOT NULL DEFAULT '',
    status                TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    is_example            BOOLEAN     NOT NULL DEFAULT FALSE,
    published_version_id  UUID,
    draft_version_id      UUID,
    last_published_at     TIMESTAMPTZ,
    archived_at           TIMESTAMPTZ,
    created_by            UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_items_department_idx ON public.knowledge_items(department_id, status);
CREATE INDEX IF NOT EXISTS knowledge_items_topic_idx ON public.knowledge_items(topic_id);

DROP TRIGGER IF EXISTS knowledge_items_updated_at ON public.knowledge_items;
CREATE TRIGGER knowledge_items_updated_at
    BEFORE UPDATE ON public.knowledge_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Every publish freezes one version row (published_at set); old versions are
-- kept for audit (US-100). A draft row is mutable until it's published.
-- The uploaded file (file_path) is kept for download, separate from the
-- extracted_text the AI reads (US-100).
CREATE TABLE IF NOT EXISTS public.knowledge_item_versions (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id            UUID        NOT NULL REFERENCES public.knowledge_items(id) ON DELETE CASCADE,
    version_number     INTEGER     NOT NULL,
    title              TEXT        NOT NULL,
    description        TEXT        NOT NULL DEFAULT '',
    content            TEXT        NOT NULL DEFAULT '',   -- markdown (text items)
    url                TEXT,                              -- video / link items
    file_path          TEXT,                              -- document items (storage)
    file_name          TEXT,
    file_mime          TEXT,
    file_size          BIGINT,
    extracted_text     TEXT,                              -- what the AI reads (documents)
    char_count         INTEGER     NOT NULL DEFAULT 0,
    extraction_status  TEXT        NOT NULL DEFAULT 'ready'
                       CHECK (extraction_status IN ('pending', 'processing', 'ready', 'needs_attention', 'failed')),
    extraction_error   TEXT,
    extraction_started_at TIMESTAMPTZ,
    index_status       TEXT        NOT NULL DEFAULT 'not_indexed'
                       CHECK (index_status IN ('not_indexed', 'indexing', 'indexed')),
    chunk_count        INTEGER     NOT NULL DEFAULT 0,
    restored_from_version_id UUID,
    created_by         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at       TIMESTAMPTZ,
    published_by       UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    UNIQUE (item_id, version_number)
);
CREATE INDEX IF NOT EXISTS knowledge_item_versions_item_idx ON public.knowledge_item_versions(item_id, version_number DESC);

DROP TRIGGER IF EXISTS knowledge_item_versions_updated_at ON public.knowledge_item_versions;
CREATE TRIGGER knowledge_item_versions_updated_at
    BEFORE UPDATE ON public.knowledge_item_versions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_items_published_version_fk') THEN
        ALTER TABLE public.knowledge_items
            ADD CONSTRAINT knowledge_items_published_version_fk
            FOREIGN KEY (published_version_id) REFERENCES public.knowledge_item_versions(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_items_draft_version_fk') THEN
        ALTER TABLE public.knowledge_items
            ADD CONSTRAINT knowledge_items_draft_version_fk
            FOREIGN KEY (draft_version_id) REFERENCES public.knowledge_item_versions(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ------------------------------------------------------------
-- 5. SEARCH INDEX (US-106, US-123)
-- ------------------------------------------------------------
-- Passages of one specific version. Unique (version_id, chunk_index) makes
-- re-running indexing an upsert, so a retry never creates duplicates.
-- No ANN (HNSW) index on `embedding` on purpose: the department filter is
-- applied before ranking, and an exact scan over a TRC-sized corpus (tens of
-- thousands of passages) is fast and never drops filtered-out neighbours the
-- way a post-filtered ANN scan can. Add HNSW + iterative scan if this ever
-- grows past ~100k passages.
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    version_id    UUID        NOT NULL REFERENCES public.knowledge_item_versions(id) ON DELETE CASCADE,
    item_id       UUID        NOT NULL REFERENCES public.knowledge_items(id) ON DELETE CASCADE,
    chunk_index   INTEGER     NOT NULL,
    title         TEXT        NOT NULL DEFAULT '',
    heading       TEXT        NOT NULL DEFAULT '',
    content       TEXT        NOT NULL,
    tsv           TSVECTOR GENERATED ALWAYS AS (
                      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                      setweight(to_tsvector('english', coalesce(heading, '')), 'B') ||
                      setweight(to_tsvector('english', coalesce(content, '')), 'C')
                  ) STORED,
    embedding     extensions.vector(1536),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (version_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_tsv_idx ON public.knowledge_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS knowledge_chunks_item_idx ON public.knowledge_chunks(item_id);

-- Hybrid retrieval over ONLY the live (published, non-archived, current
-- version) passages of the given departments. Semantic hits must clear a
-- minimum cosine similarity so an unrelated question returns nothing (and the
-- chat route then answers "no approved answer" without any Claude cost).
CREATE OR REPLACE FUNCTION public.knowledge_search(
    p_department_ids  UUID[],
    p_query_embedding extensions.vector(1536) DEFAULT NULL,
    p_fts_query       TEXT DEFAULT NULL,
    p_match_count     INTEGER DEFAULT 14,
    p_examples_only   BOOLEAN DEFAULT FALSE,
    p_min_similarity  DOUBLE PRECISION DEFAULT 0.25
)
RETURNS TABLE (
    chunk_id      UUID,
    item_id       UUID,
    version_id    UUID,
    department_id UUID,
    chunk_index   INTEGER,
    heading       TEXT,
    content       TEXT,
    similarity    DOUBLE PRECISION,
    score         DOUBLE PRECISION
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    WITH live AS MATERIALIZED (
        SELECT c.id, c.item_id, c.version_id, i.department_id, c.chunk_index,
               c.heading, c.content, c.tsv, c.embedding
        FROM public.knowledge_chunks c
        JOIN public.knowledge_items i
          ON i.id = c.item_id AND i.published_version_id = c.version_id
        JOIN public.knowledge_departments d ON d.id = i.department_id
        WHERE i.status = 'published'
          AND d.archived_at IS NULL
          AND i.department_id = ANY(p_department_ids)
          AND (NOT p_examples_only OR i.is_example)
    ),
    sem AS (
        SELECT l.id, 1 - (l.embedding <=> p_query_embedding) AS sim,
               row_number() OVER (ORDER BY l.embedding <=> p_query_embedding) AS r
        FROM live l
        WHERE p_query_embedding IS NOT NULL
          AND l.embedding IS NOT NULL
          AND 1 - (l.embedding <=> p_query_embedding) >= p_min_similarity
        ORDER BY l.embedding <=> p_query_embedding
        LIMIT 60
    ),
    kw AS (
        SELECT l.id,
               row_number() OVER (ORDER BY ts_rank_cd(l.tsv, q) DESC) AS r
        FROM live l, to_tsquery('english', coalesce(p_fts_query, '')) q
        WHERE coalesce(p_fts_query, '') <> ''
          AND l.tsv @@ q
        ORDER BY ts_rank_cd(l.tsv, q) DESC
        LIMIT 60
    ),
    fused AS (
        SELECT coalesce(sem.id, kw.id) AS id,
               sem.sim,
               coalesce(1.0 / (60 + sem.r), 0) + coalesce(1.0 / (60 + kw.r), 0) AS score
        FROM sem FULL OUTER JOIN kw ON sem.id = kw.id
    )
    SELECT l.id, l.item_id, l.version_id, l.department_id, l.chunk_index,
           l.heading, l.content, f.sim, f.score
    FROM fused f
    JOIN live l ON l.id = f.id
    ORDER BY f.score DESC
    LIMIT p_match_count;
$$;

REVOKE ALL ON FUNCTION public.knowledge_search(UUID[], extensions.vector, TEXT, INTEGER, BOOLEAN, DOUBLE PRECISION) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.knowledge_search(UUID[], extensions.vector, TEXT, INTEGER, BOOLEAN, DOUBLE PRECISION) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_search(UUID[], extensions.vector, TEXT, INTEGER, BOOLEAN, DOUBLE PRECISION) TO service_role;

-- ------------------------------------------------------------
-- 6. CHAT (US-109 → US-112, US-118)
-- ------------------------------------------------------------
-- user_id SET NULL on profile delete so the admin log keeps history.
CREATE TABLE IF NOT EXISTS public.knowledge_chats (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    title       TEXT        NOT NULL DEFAULT 'New chat',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_chats_user_idx ON public.knowledge_chats(user_id, updated_at DESC);

-- `sources` is a snapshot (title, department, Guardian, last updated…) taken
-- at answer time so history still renders after an item is archived (US-108).
-- `used_version_ids` = every item version handed to the model (US-100).
-- `department_ids` = the departments searched for this question (admin filter).
CREATE TABLE IF NOT EXISTS public.knowledge_messages (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id           UUID        NOT NULL REFERENCES public.knowledge_chats(id) ON DELETE CASCADE,
    role              TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content           TEXT        NOT NULL DEFAULT '',
    sources           JSONB       NOT NULL DEFAULT '[]'::jsonb,
    used_version_ids  UUID[]      NOT NULL DEFAULT '{}',
    department_ids    UUID[]      NOT NULL DEFAULT '{}',
    no_answer         BOOLEAN     NOT NULL DEFAULT FALSE,
    status            TEXT        NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'failed')),
    tokens_total      INTEGER     NOT NULL DEFAULT 0,
    cost_usd          NUMERIC(12, 6) NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_messages_chat_idx ON public.knowledge_messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS knowledge_messages_created_idx ON public.knowledge_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_messages_departments_idx ON public.knowledge_messages USING GIN (department_ids);

-- ------------------------------------------------------------
-- 7. FEEDBACK + SUGGESTIONS (US-115 → US-117)
-- ------------------------------------------------------------
-- One queue for both: `kind` = 'feedback' (a rating on an answer) or
-- 'suggestion' (a proposed change or new knowledge). Routed by department, not
-- by person, so changing a department's Guardian moves every open entry to
-- the new Guardian automatically (US-098). "Helpful" ratings are recorded
-- (status 'done') but never land in a Guardian's queue.
CREATE TABLE IF NOT EXISTS public.knowledge_feedback (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind             TEXT        NOT NULL CHECK (kind IN ('feedback', 'suggestion')),
    rating           TEXT        CHECK (rating IN ('helpful', 'unclear', 'incorrect', 'outdated', 'missing')),
    suggestion_type  TEXT        CHECK (suggestion_type IN ('change', 'new')),
    comment          TEXT        NOT NULL DEFAULT '',
    link_url         TEXT,
    attachment_path  TEXT,
    attachment_name  TEXT,
    user_id          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    department_id    UUID        REFERENCES public.knowledge_departments(id) ON DELETE CASCADE,
    item_id          UUID        REFERENCES public.knowledge_items(id) ON DELETE SET NULL,
    message_id       UUID        REFERENCES public.knowledge_messages(id) ON DELETE SET NULL,
    status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'done')),
    guardian_note    TEXT,
    resolved_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_feedback_department_idx ON public.knowledge_feedback(department_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_feedback_user_idx ON public.knowledge_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_feedback_item_idx ON public.knowledge_feedback(item_id);
CREATE INDEX IF NOT EXISTS knowledge_feedback_message_idx ON public.knowledge_feedback(message_id);

DROP TRIGGER IF EXISTS knowledge_feedback_updated_at ON public.knowledge_feedback;
CREATE TRIGGER knowledge_feedback_updated_at
    BEFORE UPDATE ON public.knowledge_feedback
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 8. RLS — enabled, no policies (service role only; see header)
-- ------------------------------------------------------------
ALTER TABLE public.knowledge_departments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_department_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_topics             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_item_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chats              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_feedback           ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 9. STORAGE — private bucket; uploads go through server-minted signed
--    upload URLs (after a Guardian/member check), downloads through
--    short-lived signed URLs. No storage policies needed.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-base', 'knowledge-base', FALSE)
ON CONFLICT (id) DO NOTHING;
