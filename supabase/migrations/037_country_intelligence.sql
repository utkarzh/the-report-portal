-- ============================================================
-- 037 — Country Intelligence (Commercial)
--
-- On-demand company & leader research for a country report: discovery of
-- companies by sector, a full profile of each one (company + leader +
-- revenue/scale), strict commercial qualification, dedicated outreach-contact
-- research, and free automatic verification of those contacts. It is the
-- in-app version of the manual Poland / Munich Security Conference run of
-- 13 Oct 2026 (see "Country Intelligence module" in CLAUDE.md).
--
-- Work is split into small resumable units (ci_tasks) so a long run never
-- depends on one serverless request: the project page calls
-- /api/country-intel/[id]/step repeatedly and each call works the queue for a
-- few minutes. ci_claim_tasks() claims units atomically (FOR UPDATE SKIP
-- LOCKED) and reclaims units whose worker died mid-request.
--
-- Every table has RLS enabled with NO policies: all access goes through API
-- routes / server components using the service role after an admin check.
--
-- Idempotent, safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ci_projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    country         TEXT NOT NULL,
    -- Theme / event / publication angle, e.g. "Security report timed with the
    -- Munich Security Conference, February 2027". Fed into every prompt.
    brief           TEXT NOT NULL DEFAULT '',
    -- [{ "name": "Energy Security", "scope": "fuel, gas, power, grid …" }]
    sectors         JSONB NOT NULL DEFAULT '[]'::jsonb,
    target_count    INTEGER NOT NULL DEFAULT 100 CHECK (target_count BETWEEN 5 AND 500),
    depth           TEXT NOT NULL DEFAULT 'standard' CHECK (depth IN ('quick', 'standard', 'deep')),
    min_revenue_usd BIGINT NOT NULL DEFAULT 60000000,
    local_hq_only   BOOLEAN NOT NULL DEFAULT TRUE,
    include_contacts BOOLEAN NOT NULL DEFAULT TRUE,
    include_context BOOLEAN NOT NULL DEFAULT TRUE,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'running', 'paused', 'complete', 'failed')),
    -- Current phase of the run: queued | context_discovery | selecting | profiling |
    -- contacts | verifying | done | budget_reached
    phase           TEXT NOT NULL DEFAULT 'queued',
    round           INTEGER NOT NULL DEFAULT 0,
    budget_usd      NUMERIC(10, 4) NOT NULL,
    spent_usd       NUMERIC(10, 4) NOT NULL DEFAULT 0,
    -- Country context: narrative, key figures, officials, institutions, events, bilateral links.
    context         JSONB,
    error           TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ci_companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES public.ci_projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    norm_name       TEXT NOT NULL,
    origin          TEXT NOT NULL CHECK (origin IN ('client', 'discovered')),
    sector          TEXT,
    hint            TEXT,
    round           INTEGER NOT NULL DEFAULT 1,
    -- pending → profiled → (contacts researched) → verified; or failed
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'profiled', 'failed')),
    profile         JSONB,       -- parsed profile (company + leader + scale + developments + sources)
    grounding       JSONB,       -- Google Search result pages behind the profile [{title, uri}]
    contacts_raw    JSONB,       -- dedicated outreach-contact research (unverified)
    outreach        JSONB,       -- merged + verified contacts {primary, people, offices, switchboard, approach}
    verdict         JSONB,       -- {pass, label, reason} from the criteria check (in code, not the model's label)
    -- A second, independently searched revenue figure (from discovery), used to spot conflicting sources.
    alt_revenue_usd_million NUMERIC,
    contacts_done   BOOLEAN NOT NULL DEFAULT FALSE,
    verified        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, norm_name)
);
CREATE INDEX IF NOT EXISTS ci_companies_project_idx ON public.ci_companies (project_id);

CREATE TABLE IF NOT EXISTS public.ci_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES public.ci_projects(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('context', 'collect', 'select', 'profile', 'contacts', 'verify')),
    round           INTEGER NOT NULL DEFAULT 1,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    result          JSONB,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'done', 'failed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    cost_usd        NUMERIC(10, 5) NOT NULL DEFAULT 0,
    searches        INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    locked_at       TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ci_tasks_project_status_idx ON public.ci_tasks (project_id, status);

-- Admin-editable system prompt (singleton) + version history (snapshot-before-save, like every other prompt).
CREATE TABLE IF NOT EXISTS public.ci_system_prompt (
    id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    prompt_text TEXT NOT NULL,
    updated_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ci_system_prompt_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_text TEXT NOT NULL,
    saved_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ci_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_system_prompt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_system_prompt_versions ENABLE ROW LEVEL SECURITY;

-- Claim up to p_limit runnable tasks of a project atomically. A task left
-- 'running' for more than 7 minutes belongs to a worker that died (a
-- serverless request cut off at its time limit) and is handed out again.
CREATE OR REPLACE FUNCTION public.ci_claim_tasks(p_project UUID, p_limit INTEGER)
RETURNS SETOF public.ci_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.ci_tasks t
       SET status = 'running', locked_at = now(), attempts = t.attempts + 1
     WHERE t.id IN (
            SELECT c.id FROM public.ci_tasks c
             WHERE c.project_id = p_project
               AND (c.status = 'pending'
                    OR (c.status = 'running' AND c.locked_at < now() - INTERVAL '7 minutes'))
             ORDER BY c.created_at, c.id
             FOR UPDATE SKIP LOCKED
             LIMIT p_limit)
    RETURNING t.*;
END;
$$;

-- Add spend to a project atomically and return the new total.
CREATE OR REPLACE FUNCTION public.ci_add_spend(p_project UUID, p_cost NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.ci_projects
       SET spent_usd = spent_usd + p_cost, updated_at = now()
     WHERE id = p_project
    RETURNING spent_usd;
$$;

REVOKE ALL ON FUNCTION public.ci_claim_tasks(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ci_add_spend(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
